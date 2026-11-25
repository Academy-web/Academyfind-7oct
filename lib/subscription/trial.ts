import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { enqueueOutboxEvent } from "@/lib/subscription/outbox";
import type { Prisma, TrialSource } from "@/app/generated/prisma/client";

export const TRIAL_DURATION_DAYS = 7;
export const MAX_TOTAL_TRIAL_DAYS = 14;
export const ULTRA_PLAN_WEIGHT = 4;
export const BASIC_PLAN_WEIGHT = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export function generateTrialToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashTrialToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashTrialToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Acquires a PostgreSQL row-level FOR UPDATE lock on the Institute row.
 * All competing lifecycle mutations MUST call this first inside prisma.$transaction.
 */
export async function lockInstituteRow(tx: Prisma.TransactionClient, instituteId: string) {
  await tx.$executeRaw`SELECT id FROM "Institute" WHERE id = ${instituteId} FOR UPDATE`;
}

export interface TrialActionResult {
  success: boolean;
  alreadyActive?: boolean;
  code?: string;
  error?: string;
  trialId?: string;
  instituteId?: string;
  expiresAt?: Date;
}

/**
 * Creates or reuses a PENDING trial record for an institute (e.g. email campaign or approval).
 * Does NOT set hasUsedTrial = true.
 */
export async function createOrReusePendingTrial(params: {
  instituteId: string;
  source: TrialSource;
  recipientEmail?: string | null;
  campaignBatchId?: string | null;
  tokenHash?: string | null;
  tokenExpiresAt?: Date | null;
  markEmailSent?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await lockInstituteRow(tx, params.instituteId);

    const institute = await tx.institute.findUnique({
      where: { id: params.instituteId },
      select: { id: true, subscriptionPlan: true, hasUsedTrial: true },
    });

    if (!institute) {
      return { success: false, code: "NOT_FOUND", error: "Institute not found." };
    }

    if (institute.hasUsedTrial || institute.subscriptionPlan !== "BASIC") {
      return {
        success: false,
        code: "INELIGIBLE",
        error: "Institute has already used its trial or is not on BASIC.",
      };
    }

    const existingPending = await tx.instituteTrial.findFirst({
      where: { instituteId: params.instituteId, status: "PENDING" },
    });

    const now = new Date();
    if (existingPending) {
      const updated = await tx.instituteTrial.update({
        where: { id: existingPending.id },
        data: {
          source: params.source,
          recipientEmail: params.recipientEmail ?? existingPending.recipientEmail,
          campaignBatchId: params.campaignBatchId ?? existingPending.campaignBatchId,
          tokenHash: params.tokenHash !== undefined ? params.tokenHash : existingPending.tokenHash,
          tokenExpiresAt:
            params.tokenExpiresAt !== undefined ? params.tokenExpiresAt : existingPending.tokenExpiresAt,
          emailSentAt: params.markEmailSent ? now : existingPending.emailSentAt,
        },
      });
      return { success: true, reused: true, trial: updated };
    }

    const created = await tx.instituteTrial.create({
      data: {
        instituteId: params.instituteId,
        source: params.source,
        status: "PENDING",
        recipientEmail: params.recipientEmail ?? null,
        campaignBatchId: params.campaignBatchId ?? null,
        tokenHash: params.tokenHash ?? null,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        emailSentAt: params.markEmailSent ? now : null,
      },
    });

    return { success: true, reused: false, trial: created };
  });
}

/**
 * Records a GET link access (may be an email scanner). Never activates or sets hasUsedTrial.
 */
export async function recordTokenLinkAccess(tokenHash: string) {
  const trial = await prisma.instituteTrial.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      instituteId: true,
      status: true,
      tokenExpiresAt: true,
      linkAccessedAt: true,
      startedAt: true,
      expiresAt: true,
      institute: {
        select: {
          id: true,
          name: true,
          slug: true,
          subscriptionPlan: true,
          hasUsedTrial: true,
        },
      },
    },
  });

  if (!trial) return null;

  await prisma.instituteTrial.update({
    where: { id: trial.id },
    data: {
      linkAccessedAt: trial.linkAccessedAt ?? new Date(),
      accessCount: { increment: 1 },
    },
  });

  return trial;
}

/**
 * Records confirmed client-side interaction (not authorization).
 */
export async function confirmHumanClick(tokenHash: string) {
  await prisma.instituteTrial.updateMany({
    where: { tokenHash, humanClickConfirmedAt: null },
    data: { humanClickConfirmedAt: new Date() },
  });
}

/**
 * Email Activation Path:
 * Validates tokenHash, unexpired token, matching PENDING trial, locks Institute FOR UPDATE,
 * flips hasUsedTrial = true, transitions PENDING -> ACTIVE, and enqueues OutboxEvent.
 */
export async function activateTrialFromToken(params: {
  tokenHash: string;
  actorUserId?: string | null;
}): Promise<TrialActionResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * DAY_MS);

  return prisma.$transaction(async (tx) => {
    const trial = await tx.instituteTrial.findUnique({
      where: { tokenHash: params.tokenHash },
    });

    if (!trial) {
      return { success: false, code: "INVALID_TOKEN", error: "Invalid or unknown trial token." };
    }

    await lockInstituteRow(tx, trial.instituteId);

    // Re-read after lock
    const lockedTrial = await tx.instituteTrial.findUnique({ where: { id: trial.id } });
    if (!lockedTrial) {
      return { success: false, code: "INVALID_TOKEN", error: "Trial record not found." };
    }

    if (lockedTrial.status === "ACTIVE" && lockedTrial.expiresAt && lockedTrial.expiresAt > now) {
      return {
        success: true,
        alreadyActive: true,
        trialId: lockedTrial.id,
        instituteId: lockedTrial.instituteId,
        expiresAt: lockedTrial.expiresAt,
      };
    }

    if (lockedTrial.status !== "PENDING") {
      return {
        success: false,
        code: "TRIAL_NOT_PENDING",
        error: `This trial link is no longer active (status: ${lockedTrial.status}).`,
        instituteId: lockedTrial.instituteId,
      };
    }

    if (lockedTrial.tokenExpiresAt && lockedTrial.tokenExpiresAt <= now) {
      return {
        success: false,
        code: "TOKEN_EXPIRED",
        error: "This activation link has expired.",
        instituteId: lockedTrial.instituteId,
      };
    }

    // Fail-closed conditional update on Institute
    const claimed = await tx.institute.updateMany({
      where: {
        id: lockedTrial.instituteId,
        hasUsedTrial: false,
        subscriptionPlan: "BASIC",
      },
      data: {
        hasUsedTrial: true,
        subscriptionPlan: "ULTRA",
        planWeight: ULTRA_PLAN_WEIGHT,
        planExpiresAt: expiresAt,
      },
    });

    if (claimed.count === 0) {
      return {
        success: false,
        code: "INELIGIBLE",
        error: "This institute is not eligible for a free trial.",
        instituteId: lockedTrial.instituteId,
      };
    }

    const activated = await tx.instituteTrial.updateMany({
      where: { id: lockedTrial.id, status: "PENDING" },
      data: {
        status: "ACTIVE",
        startedAt: now,
        expiresAt,
        activatedByUserId: params.actorUserId ?? null,
        humanClickConfirmedAt: lockedTrial.humanClickConfirmedAt ?? now,
      },
    });

    if (activated.count !== 1) {
      throw new Error("Concurrent trial state modification detected.");
    }

    await tx.trialAuditLog.create({
      data: {
        trialId: lockedTrial.id,
        instituteId: lockedTrial.instituteId,
        actorUserId: params.actorUserId ?? null,
        action: "ACTIVATED",
        reason: "Activated via email token landing page",
        metadata: { source: lockedTrial.source, expiresAt: expiresAt.toISOString() },
      },
    });

    await enqueueOutboxEvent(tx, {
      eventType: "MEILISEARCH_SYNC_INSTITUTE",
      aggregateId: lockedTrial.instituteId,
      payload: { reason: "TRIAL_ACTIVATED", trialId: lockedTrial.id },
    });

    return {
      success: true,
      alreadyActive: false,
      trialId: lockedTrial.id,
      instituteId: lockedTrial.instituteId,
      expiresAt,
    };
  });
}

/**
 * Dashboard Activation Path:
 * Verifies authenticated InstituteManager (or ADMIN), locks Institute FOR UPDATE,
 * activates 7-day ULTRA trial atomically, and enqueues OutboxEvent.
 */
export async function activateTrialFromDashboard(params: {
  instituteId: string;
  userId: string;
  userRole?: string | null;
  defaultSource?: TrialSource;
}): Promise<TrialActionResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * DAY_MS);

  return prisma.$transaction(async (tx) => {
    if (params.userRole !== "ADMIN") {
      const membership = await tx.instituteManager.findUnique({
        where: {
          userId_instituteId: {
            userId: params.userId,
            instituteId: params.instituteId,
          },
        },
      });
      if (!membership) {
        return {
          success: false,
          code: "FORBIDDEN",
          error: "You are not authorized to manage this institute.",
        };
      }
    }

    await lockInstituteRow(tx, params.instituteId);

    const activeTrial = await tx.instituteTrial.findFirst({
      where: { instituteId: params.instituteId, status: "ACTIVE" },
    });

    if (activeTrial && activeTrial.expiresAt && activeTrial.expiresAt > now) {
      return {
        success: true,
        alreadyActive: true,
        trialId: activeTrial.id,
        instituteId: params.instituteId,
        expiresAt: activeTrial.expiresAt,
      };
    }

    const claimed = await tx.institute.updateMany({
      where: {
        id: params.instituteId,
        hasUsedTrial: false,
        subscriptionPlan: "BASIC",
      },
      data: {
        hasUsedTrial: true,
        subscriptionPlan: "ULTRA",
        planWeight: ULTRA_PLAN_WEIGHT,
        planExpiresAt: expiresAt,
      },
    });

    if (claimed.count === 0) {
      return {
        success: false,
        code: "INELIGIBLE",
        error: "This institute has already used its free trial or is on a paid plan.",
        instituteId: params.instituteId,
      };
    }

    const pendingTrial = await tx.instituteTrial.findFirst({
      where: { instituteId: params.instituteId, status: "PENDING" },
    });

    let trialId: string;
    if (pendingTrial) {
      const updated = await tx.instituteTrial.updateMany({
        where: { id: pendingTrial.id, status: "PENDING" },
        data: {
          status: "ACTIVE",
          startedAt: now,
          expiresAt,
          activatedByUserId: params.userId,
        },
      });
      if (updated.count !== 1) {
        throw new Error("Concurrent pending trial transition detected.");
      }
      trialId = pendingTrial.id;
    } else {
      const created = await tx.instituteTrial.create({
        data: {
          instituteId: params.instituteId,
          activatedByUserId: params.userId,
          source: params.defaultSource ?? "NEW_CLAIM",
          status: "ACTIVE",
          startedAt: now,
          expiresAt,
        },
      });
      trialId = created.id;
    }

    await tx.trialAuditLog.create({
      data: {
        trialId,
        instituteId: params.instituteId,
        actorUserId: params.userId,
        action: "ACTIVATED",
        reason: "Activated from Manager Dashboard",
        metadata: { expiresAt: expiresAt.toISOString() },
      },
    });

    await enqueueOutboxEvent(tx, {
      eventType: "MEILISEARCH_SYNC_INSTITUTE",
      aggregateId: params.instituteId,
      payload: { reason: "DASHBOARD_TRIAL_ACTIVATED", trialId },
    });

    return {
      success: true,
      alreadyActive: false,
      trialId,
      instituteId: params.instituteId,
      expiresAt,
    };
  });
}

/**
 * Admin Extension Policy:
 * - ADMIN only, mandatory reason.
 * - Trial must be ACTIVE.
 * - Maximum total trial duration = 14 days measured from original `startedAt`.
 */
export async function adminExtendTrial(params: {
  trialId: string;
  adminUserId: string;
  additionalDays: number;
  reason: string;
}): Promise<TrialActionResult> {
  if (!params.reason.trim()) {
    return { success: false, code: "REASON_REQUIRED", error: "Audit reason is required." };
  }
  if (!Number.isInteger(params.additionalDays) || params.additionalDays < 1) {
    return { success: false, code: "INVALID_DAYS", error: "Additional days must be >= 1." };
  }

  return prisma.$transaction(async (tx) => {
    const trial = await tx.instituteTrial.findUnique({ where: { id: params.trialId } });
    if (!trial) {
      return { success: false, code: "NOT_FOUND", error: "Trial not found." };
    }

    await lockInstituteRow(tx, trial.instituteId);

    const lockedTrial = await tx.instituteTrial.findUnique({ where: { id: params.trialId } });
    if (!lockedTrial || lockedTrial.status !== "ACTIVE" || !lockedTrial.startedAt || !lockedTrial.expiresAt) {
      return {
        success: false,
        code: "TRIAL_NOT_ACTIVE",
        error: "Only ACTIVE trials can be extended. Expired trials require an explicit admin override.",
      };
    }

    const maxAllowedExpiresAt = new Date(
      lockedTrial.startedAt.getTime() + MAX_TOTAL_TRIAL_DAYS * DAY_MS
    );
    const newExpiresAt = new Date(
      lockedTrial.expiresAt.getTime() + params.additionalDays * DAY_MS
    );

    if (newExpiresAt.getTime() > maxAllowedExpiresAt.getTime()) {
      return {
        success: false,
        code: "MAX_EXTENSION_EXCEEDED",
        error: `Extension exceeds maximum total trial duration of ${MAX_TOTAL_TRIAL_DAYS} days from start date.`,
      };
    }

    await tx.instituteTrial.update({
      where: { id: lockedTrial.id },
      data: { expiresAt: newExpiresAt },
    });

    await tx.institute.update({
      where: { id: lockedTrial.instituteId },
      data: { planExpiresAt: newExpiresAt },
    });

    await tx.trialAuditLog.create({
      data: {
        trialId: lockedTrial.id,
        instituteId: lockedTrial.instituteId,
        actorUserId: params.adminUserId,
        action: "EXTENDED",
        reason: params.reason.trim(),
        metadata: {
          additionalDays: params.additionalDays,
          previousExpiresAt: lockedTrial.expiresAt.toISOString(),
          newExpiresAt: newExpiresAt.toISOString(),
        },
      },
    });

    await enqueueOutboxEvent(tx, {
      eventType: "MEILISEARCH_SYNC_INSTITUTE",
      aggregateId: lockedTrial.instituteId,
      payload: { reason: "TRIAL_EXTENDED", trialId: lockedTrial.id },
    });

    return {
      success: true,
      trialId: lockedTrial.id,
      instituteId: lockedTrial.instituteId,
      expiresAt: newExpiresAt,
    };
  });
}

/**
 * Admin Grant / Override Path:
 * Grants an ACTIVE ULTRA trial (1..14 days) with mandatory audit reason.
 * Sets hasUsedTrial = true and never overwrites an active paid subscription.
 */
export async function adminGrantTrialOverride(params: {
  instituteId: string;
  adminUserId: string;
  reason: string;
  days?: number;
}): Promise<TrialActionResult> {
  const days = params.days ?? TRIAL_DURATION_DAYS;
  if (!params.reason.trim()) {
    return { success: false, code: "REASON_REQUIRED", error: "Audit reason is required." };
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_TOTAL_TRIAL_DAYS) {
    return {
      success: false,
      code: "INVALID_DAYS",
      error: `Trial duration must be between 1 and ${MAX_TOTAL_TRIAL_DAYS} days.`,
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * DAY_MS);

  return prisma.$transaction(async (tx) => {
    await lockInstituteRow(tx, params.instituteId);

    const institute = await tx.institute.findUnique({
      where: { id: params.instituteId },
      select: { id: true, subscriptionPlan: true, planExpiresAt: true, hasUsedTrial: true },
    });

    if (!institute) {
      return { success: false, code: "NOT_FOUND", error: "Institute not found." };
    }

    const existingActive = await tx.instituteTrial.findFirst({
      where: { instituteId: params.instituteId, status: "ACTIVE" },
    });

    if (existingActive) {
      return {
        success: false,
        code: "ALREADY_ACTIVE",
        error: "Institute already has an ACTIVE trial. Use extend instead.",
      };
    }

    const hasValidPaidPlan =
      institute.subscriptionPlan !== "BASIC" &&
      (!institute.planExpiresAt || institute.planExpiresAt > now);

    if (hasValidPaidPlan) {
      return {
        success: false,
        code: "PAID_PLAN_ACTIVE",
        error: "Cannot override an institute with an active paid subscription.",
      };
    }

    // Cancel any existing PENDING trial so partial unique indexes stay clean
    await tx.instituteTrial.updateMany({
      where: { instituteId: params.instituteId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    await tx.institute.update({
      where: { id: params.instituteId },
      data: {
        hasUsedTrial: true,
        subscriptionPlan: "ULTRA",
        planWeight: ULTRA_PLAN_WEIGHT,
        planExpiresAt: expiresAt,
      },
    });

    const created = await tx.instituteTrial.create({
      data: {
        instituteId: params.instituteId,
        activatedByUserId: params.adminUserId,
        source: "ADMIN_GRANT",
        status: "ACTIVE",
        startedAt: now,
        expiresAt,
      },
    });

    await tx.trialAuditLog.create({
      data: {
        trialId: created.id,
        instituteId: params.instituteId,
        actorUserId: params.adminUserId,
        action: institute.hasUsedTrial ? "ADMIN_OVERRIDE" : "ADMIN_GRANTED",
        reason: params.reason.trim(),
        metadata: { days, expiresAt: expiresAt.toISOString() },
      },
    });

    await enqueueOutboxEvent(tx, {
      eventType: "MEILISEARCH_SYNC_INSTITUTE",
      aggregateId: params.instituteId,
      payload: { reason: "ADMIN_GRANT", trialId: created.id },
    });

    return {
      success: true,
      trialId: created.id,
      instituteId: params.instituteId,
      expiresAt,
    };
  });
}
