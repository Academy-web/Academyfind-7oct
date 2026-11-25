import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const WEBHOOK_LEASE_MS = 5 * 60 * 1000;

function verifyResendSignature(rawBody: string, headers: Headers): { ok: boolean; missingSecret?: boolean } {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, missingSecret: true };
    }
    return { ok: true };
  }

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) return { ok: false };

  // Reject stale timestamps (> 5 minutes)
  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return { ok: false };
  }

  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  const candidateSigs = svixSignature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean);

  const ok = candidateSigs.some((sig) => {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return { ok };
}

export async function POST(request: Request) {
  let rawBody = "";
  try {
    rawBody = await request.text();
    const sigCheck = verifyResendSignature(rawBody, request.headers);
    if (!sigCheck.ok) {
      if (sigCheck.missingSecret) {
        console.error("RESEND_WEBHOOK_SECRET is required in production");
        return NextResponse.json({ success: false, error: "Webhook secret not configured" }, { status: 500 });
      }
      return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventType: string = payload?.type || "";
    const svixId = request.headers.get("svix-id");
    const providerEventId: string =
      svixId || payload?.data?.email_id
        ? `${svixId || payload.data.email_id}:${eventType}`
        : "";

    if (!providerEventId || !eventType) {
      return NextResponse.json({ success: false, error: "Malformed webhook payload" }, { status: 400 });
    }

    // 1. Conflict-safe insert
    await prisma.webhookEvent.createMany({
      data: [
        {
          provider: "resend",
          providerEventId,
          eventType,
          status: "PENDING",
        },
      ],
      skipDuplicates: true,
    });

    const existing = await prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: "resend",
          providerEventId,
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ success: false, error: "Webhook tracking error" }, { status: 500 });
    }

    if (existing.status === "COMPLETED") {
      return NextResponse.json({ success: true, deduplicated: true });
    }

    // 2. Claim PENDING or lease-expired PROCESSING event atomically
    const now = new Date();
    const staleBefore = new Date(now.getTime() - WEBHOOK_LEASE_MS);
    const claimed = await prisma.webhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: "PENDING" },
          { status: "PROCESSING", lockedAt: { lt: staleBefore } },
          { status: "FAILED" },
        ],
      },
      data: {
        status: "PROCESSING",
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });

    if (claimed.count !== 1) {
      return NextResponse.json({ success: true, inFlight: true });
    }

    // 3. Apply idempotent business update inside transaction
    try {
      const recipientList: string[] = Array.isArray(payload?.data?.to)
        ? payload.data.to
        : typeof payload?.data?.to === "string"
        ? [payload.data.to]
        : [];
      const recipientEmail = recipientList[0];

      await prisma.$transaction(async (tx) => {
        if (recipientEmail) {
          if (eventType === "email.delivered") {
            await tx.instituteTrial.updateMany({
              where: {
                recipientEmail,
                emailDeliveredAt: null,
                status: { in: ["PENDING", "ACTIVE"] },
              },
              data: { emailDeliveredAt: now },
            });
          } else if (eventType === "email.bounced" || eventType === "email.complained") {
            await tx.instituteTrial.updateMany({
              where: {
                recipientEmail,
                emailBouncedAt: null,
                status: { in: ["PENDING", "ACTIVE"] },
              },
              data: { emailBouncedAt: now },
            });
          }
        }

        await tx.webhookEvent.update({
          where: { id: existing.id },
          data: {
            status: "COMPLETED",
            processedAt: now,
            lockedAt: null,
            lastError: null,
          },
        });
      });

      return NextResponse.json({ success: true });
    } catch (processErr) {
      const errMsg = processErr instanceof Error ? processErr.message : String(processErr);
      await prisma.webhookEvent.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          lockedAt: null,
          lastError: errMsg,
        },
      });
      throw processErr;
    }
  } catch (err) {
    console.error("Resend webhook error:", err);
    return NextResponse.json({ success: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
