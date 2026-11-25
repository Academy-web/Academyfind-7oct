import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
import {
  adminExtendTrial,
  adminGrantTrialOverride,
  createOrReusePendingTrial,
  generateTrialToken,
} from "@/lib/subscription/trial";
import { processOutboxEvents } from "@/lib/subscription/outbox";
import { sendEmail } from "@/lib/notifications/email";
import { buildTrialCampaignEmailHtml } from "@/lib/notifications/trialEmails";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return null;
  }
  return session.user;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") || "ALL";
  const sourceFilter = url.searchParams.get("source") || "ALL";
  const search = url.searchParams.get("q")?.trim() || "";

  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const whereClause: any = {};
  if (statusFilter === "EXPIRING_SOON") {
    whereClause.status = "ACTIVE";
    whereClause.expiresAt = { gt: now, lte: in48h };
  } else if (statusFilter === "SENT_NOT_CLICKED") {
    whereClause.status = "PENDING";
    whereClause.emailSentAt = { not: null };
    whereClause.linkAccessedAt = null;
  } else if (statusFilter === "CLICKED_NOT_ACTIVATED") {
    whereClause.status = "PENDING";
    whereClause.linkAccessedAt = { not: null };
  } else if (statusFilter !== "ALL") {
    whereClause.status = statusFilter;
  }

  if (sourceFilter !== "ALL") {
    whereClause.source = sourceFilter;
  }

  if (search) {
    whereClause.OR = [
      { recipientEmail: { contains: search, mode: "insensitive" } },
      { institute: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [
    trials,
    allTrialsStats,
    eligibleBasicCount,
    convertedRevenueAgg,
    outboxPendingCount,
    outboxFailedEvents,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.instituteTrial.findMany({
      where: whereClause,
      include: {
        institute: {
          select: {
            id: true,
            name: true,
            slug: true,
            subscriptionPlan: true,
            city: { select: { name: true } },
            managers: {
              take: 1,
              include: { user: { select: { name: true, email: true, phone: true } } },
            },
          },
        },
        activatedBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 150,
    }),
    prisma.instituteTrial.findMany({
      select: {
        status: true,
        source: true,
        emailSentAt: true,
        emailDeliveredAt: true,
        emailBouncedAt: true,
        linkAccessedAt: true,
        humanClickConfirmedAt: true,
        startedAt: true,
        expiresAt: true,
        convertedAt: true,
        convertedPaymentId: true,
      },
    }),
    prisma.institute.count({
      where: {
        subscriptionPlan: "BASIC",
        hasUsedTrial: false,
        isActive: true,
        managers: { some: { user: { email: { not: "" } } } },
      },
    }),
    prisma.subscriptionPayment.aggregate({
      where: {
        status: "APPROVED",
        id: {
          in: (
            await prisma.instituteTrial.findMany({
              where: { status: "CONVERTED", convertedPaymentId: { not: null } },
              select: { convertedPaymentId: true },
            })
          )
            .map((t) => t.convertedPaymentId)
            .filter((id): id is string => Boolean(id)),
        },
      },
      _sum: { amountPaid: true },
    }),
    prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.outboxEvent.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    prisma.trialAuditLog.findMany({
      include: {
        institute: { select: { name: true } },
        actor: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const activeCount = allTrialsStats.filter(
    (t) => t.status === "ACTIVE" && t.expiresAt && t.expiresAt > now
  ).length;
  const expiringSoonCount = allTrialsStats.filter(
    (t) => t.status === "ACTIVE" && t.expiresAt && t.expiresAt > now && t.expiresAt <= in48h
  ).length;
  const convertedCount = allTrialsStats.filter((t) => t.status === "CONVERTED").length;
  const activatedTotal = allTrialsStats.filter((t) => t.startedAt !== null).length;

  const funnel = {
    sent: allTrialsStats.filter((t) => t.emailSentAt !== null).length,
    delivered: allTrialsStats.filter((t) => t.emailDeliveredAt !== null).length,
    bounced: allTrialsStats.filter((t) => t.emailBouncedAt !== null).length,
    linkAccessed: allTrialsStats.filter((t) => t.linkAccessedAt !== null).length,
    humanConfirmed: allTrialsStats.filter((t) => t.humanClickConfirmedAt !== null).length,
    activated: activatedTotal,
    converted: convertedCount,
    expired: allTrialsStats.filter((t) => t.status === "EXPIRED").length,
  };

  const conversionRate =
    activatedTotal > 0 ? Math.round((convertedCount / activatedTotal) * 1000) / 10 : 0;

  return NextResponse.json({
    success: true,
    kpis: {
      activeCount,
      expiringSoonCount,
      convertedCount,
      conversionRate,
      convertedRevenue: convertedRevenueAgg._sum.amountPaid ?? 0,
      eligibleBasicCount,
    },
    funnel,
    outbox: {
      pendingCount: outboxPendingCount,
      failedEvents: outboxFailedEvents,
    },
    trials,
    recentAuditLogs,
  });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const action = body?.action as string;

    if (action === "EXTEND_TRIAL") {
      const result = await adminExtendTrial({
        trialId: body.trialId,
        adminUserId: admin.id,
        additionalDays: Number(body.additionalDays),
        reason: String(body.reason || ""),
      });
      if (result.success) {
        await processOutboxEvents(3).catch(() => {});
      }
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === "GRANT_OVERRIDE") {
      const result = await adminGrantTrialOverride({
        instituteId: String(body.instituteId || ""),
        adminUserId: admin.id,
        reason: String(body.reason || ""),
        days: Number(body.days || 7),
      });
      if (result.success) {
        await processOutboxEvents(3).catch(() => {});
      }
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === "RETRY_OUTBOX") {
      await prisma.outboxEvent.updateMany({
        where: { status: "FAILED" },
        data: { status: "PENDING", attempts: 0, nextRetryAt: new Date(), lastError: null },
      });
      const stats = await processOutboxEvents(25);
      return NextResponse.json({ success: true, stats });
    }

    if (action === "SEND_CAMPAIGN") {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.academyfind.com";
      const batchLimit = Math.min(Math.max(Number(body.limit || 25), 1), 100);
      const campaignBatchId =
        typeof body.campaignBatchId === "string" && body.campaignBatchId.trim()
          ? body.campaignBatchId.trim()
          : `batch-${new Date().toISOString().slice(0, 10)}`;

      // Eligible BASIC institutes that have not used trial and have not been emailed in this batch yet
      const eligibleInstitutes = await prisma.institute.findMany({
        where: {
          subscriptionPlan: "BASIC",
          hasUsedTrial: false,
          isActive: true,
          trials: {
            none: {
              OR: [{ status: "ACTIVE" }, { campaignBatchId }],
            },
          },
          managers: { some: { user: { email: { not: "" } } } },
        },
        select: {
          id: true,
          name: true,
          managers: {
            take: 1,
            include: { user: { select: { name: true, email: true } } },
          },
        },
        take: batchLimit,
      });

      let sentCount = 0;
      let failedCount = 0;
      const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      for (const inst of eligibleInstitutes) {
        const manager = inst.managers[0]?.user;
        if (!manager?.email) continue;

        const { rawToken, tokenHash } = generateTrialToken();
        const activationUrl = `${siteUrl}/api/trial/open?token=${rawToken}`;

        const pendingRes = await createOrReusePendingTrial({
          instituteId: inst.id,
          source: "EMAIL_CAMPAIGN",
          recipientEmail: manager.email,
          campaignBatchId,
          tokenHash,
          tokenExpiresAt,
          markEmailSent: false,
        });

        if (!pendingRes.success || !pendingRes.trial) continue;

        const emailRes = await sendEmail(
          manager.email,
          `Unlock Your 7-Day Elite (ULTRA) Free Trial for ${inst.name}`,
          buildTrialCampaignEmailHtml({
            instituteName: inst.name,
            managerName: manager.name || "Manager",
            activationUrl,
          })
        );

        if (emailRes.success) {
          await prisma.instituteTrial.update({
            where: { id: pendingRes.trial.id },
            data: { emailSentAt: new Date() },
          });
          sentCount += 1;
        } else {
          failedCount += 1;
        }
      }

      return NextResponse.json({
        success: true,
        campaignBatchId,
        sentCount,
        failedCount,
        targeted: eligibleInstitutes.length,
      });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/admin/trials error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
