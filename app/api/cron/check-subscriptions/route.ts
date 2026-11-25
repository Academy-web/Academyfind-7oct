import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications/email";
import {
  buildTrial48hReminderEmailHtml,
  buildTrialExpiredEmailHtml,
} from "@/lib/notifications/trialEmails";
import { enqueueOutboxEvent, processOutboxEvents } from "@/lib/subscription/outbox";
import { BASIC_PLAN_WEIGHT, lockInstituteRow } from "@/lib/subscription/trial";

export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const now = new Date();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.academyfind.com";

    // =====================================================================
    // STEP 1: Expire ACTIVE trials (authoritative InstituteTrial lifecycle)
    // =====================================================================
    const expiredTrials = await prisma.instituteTrial.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: { lte: now },
      },
      include: {
        institute: {
          select: {
            id: true,
            name: true,
            managers: {
              select: {
                userId: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
      take: 100,
    });

    let trialsExpiredCount = 0;
    for (const trial of expiredTrials) {
      const transitioned = await prisma.$transaction(async (tx) => {
        await lockInstituteRow(tx, trial.instituteId);

        const claimed = await tx.instituteTrial.updateMany({
          where: {
            id: trial.id,
            status: "ACTIVE",
            expiresAt: { lte: now },
          },
          data: {
            status: "EXPIRED",
            expiredAt: now,
          },
        });

        if (claimed.count !== 1) return false;

        // Downgrade if institute is on trial ULTRA OR if an older paid plan already expired
        await tx.institute.updateMany({
          where: {
            id: trial.instituteId,
            OR: [
              { subscriptionPlan: "ULTRA" },
              { subscriptionPlan: { not: "BASIC" }, planExpiresAt: { lte: now } },
            ],
          },
          data: {
            subscriptionPlan: "BASIC",
            planWeight: BASIC_PLAN_WEIGHT,
          },
        });

        const notifications = trial.institute.managers.map((m) => ({
          userId: m.userId,
          entityId: trial.instituteId,
          type: "SYSTEM" as const,
          title: "7-Day Elite Trial Ended",
          body: `Your 7-day Elite free trial for ${trial.institute.name} has ended. Your institute has been moved to the Basic plan with all data preserved. Upgrade anytime to restore student leads & priority rankings.`,
          isRead: false,
        }));

        if (notifications.length > 0) {
          await tx.userNotification.createMany({ data: notifications });
        }

        await tx.trialAuditLog.create({
          data: {
            trialId: trial.id,
            instituteId: trial.instituteId,
            action: "EXPIRED",
            reason: "7-day trial period elapsed",
          },
        });

        await enqueueOutboxEvent(tx, {
          eventType: "MEILISEARCH_SYNC_INSTITUTE",
          aggregateId: trial.instituteId,
          payload: { reason: "TRIAL_EXPIRED", trialId: trial.id },
        });

        return true;
      });

      if (transitioned) {
        trialsExpiredCount += 1;
        const recipient =
          trial.recipientEmail ||
          trial.institute.managers.find((m) => m.user?.email)?.user?.email;
        const managerName =
          trial.institute.managers.find((m) => m.user?.name)?.user?.name || "Manager";

        if (recipient && !trial.expiryEmailSentAt) {
          const emailRes = await sendEmail(
            recipient,
            `Your 7-Day Elite Trial for ${trial.institute.name} Has Ended`,
            buildTrialExpiredEmailHtml({
              instituteName: trial.institute.name,
              managerName,
              subscriptionUrl: `${siteUrl}/manager/${trial.instituteId}/subscription`,
            })
          );
          if (emailRes.success) {
            await prisma.instituteTrial.update({
              where: { id: trial.id },
              data: { expiryEmailSentAt: new Date() },
            });
          }
        }
      }
    }

    // =====================================================================
    // STEP 2: Send 48-hour warning emails for ACTIVE trials
    // =====================================================================
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const expiringSoonTrials = await prisma.instituteTrial.findMany({
      where: {
        status: "ACTIVE",
        reminder48hSentAt: null,
        expiresAt: { gt: now, lte: in48Hours },
      },
      include: {
        institute: {
          select: {
            id: true,
            name: true,
            managers: {
              select: {
                userId: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
      take: 100,
    });

    let remindersSentCount = 0;
    for (const trial of expiringSoonTrials) {
      const claimed = await prisma.instituteTrial.updateMany({
        where: { id: trial.id, status: "ACTIVE", reminder48hSentAt: null },
        data: { reminder48hSentAt: now },
      });
      if (claimed.count !== 1) continue;

      const recipient =
        trial.recipientEmail ||
        trial.institute.managers.find((m) => m.user?.email)?.user?.email;
      const managerName =
        trial.institute.managers.find((m) => m.user?.name)?.user?.name || "Manager";

      if (recipient && trial.expiresAt) {
        const daysRemaining = Math.ceil(
          (trial.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        const expiresAtFormatted = trial.expiresAt.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        await sendEmail(
          recipient,
          `48 Hours Left: Your Elite Trial for ${trial.institute.name}`,
          buildTrial48hReminderEmailHtml({
            instituteName: trial.institute.name,
            managerName,
            daysRemaining,
            expiresAtFormatted,
            subscriptionUrl: `${siteUrl}/manager/${trial.instituteId}/subscription`,
          })
        );
        remindersSentCount += 1;
      }
    }

    // =====================================================================
    // STEP 3: Expire Paid Subscriptions (excluding institutes with ACTIVE trials)
    // =====================================================================
    const expiredPaidInstitutes = await prisma.institute.findMany({
      where: {
        planExpiresAt: { lt: now },
        subscriptionPlan: { not: "BASIC" },
        trials: {
          none: { status: "ACTIVE" },
        },
      },
      select: {
        id: true,
        name: true,
        subscriptionPlan: true,
        managers: { select: { userId: true } },
      },
      take: 100,
    });

    let paidExpiredCount = 0;
    for (const inst of expiredPaidInstitutes) {
      const downgraded = await prisma.$transaction(async (tx) => {
        await lockInstituteRow(tx, inst.id);

        const activeTrial = await tx.instituteTrial.findFirst({
          where: { instituteId: inst.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (activeTrial) return false;

        const updated = await tx.institute.updateMany({
          where: {
            id: inst.id,
            planExpiresAt: { lt: now },
            subscriptionPlan: { not: "BASIC" },
          },
          data: {
            subscriptionPlan: "BASIC",
            planWeight: BASIC_PLAN_WEIGHT,
          },
        });
        if (updated.count !== 1) return false;

        const notifications = inst.managers.map((m) => ({
          userId: m.userId,
          entityId: inst.id,
          type: "SYSTEM" as const,
          title: "Subscription Expired",
          body: `Your ${inst.subscriptionPlan} subscription for ${inst.name} has expired. Your institute has been moved to the Basic plan. Renew now to restore student leads & priority rankings.`,
          isRead: false,
        }));

        if (notifications.length > 0) {
          await tx.userNotification.createMany({ data: notifications });
        }

        await enqueueOutboxEvent(tx, {
          eventType: "MEILISEARCH_SYNC_INSTITUTE",
          aggregateId: inst.id,
          payload: { reason: "PAID_PLAN_EXPIRED" },
        });

        return true;
      });

      if (downgraded) paidExpiredCount += 1;
    }

    // =====================================================================
    // STEP 4: Process pending / recoverable OutboxEvents (Meilisearch syncs)
    // =====================================================================
    const outboxStats = await processOutboxEvents(25);

    return NextResponse.json({
      success: true,
      trialsExpired: trialsExpiredCount,
      remindersSent: remindersSentCount,
      paidExpired: paidExpiredCount,
      outbox: outboxStats,
    });
  } catch (error) {
    console.error("Error in check-subscriptions cron:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
