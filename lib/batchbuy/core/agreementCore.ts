import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import {
  SaveInstituteAgreementSchema,
  AcceptInstituteAgreementSchema,
  RATE_TIER_PERCENTAGE_MAP,
  type SaveInstituteAgreementInput,
} from "../commissionMath";
import { writeBatchBuyAuditLogTx } from "../redemptionAuth";

/**
 * Resolves the single active, in-window InstituteBatchBuyAgreement inside an active
 * transaction. Never falls back to a silent default rate.
 */
export async function getActiveAgreementForInstituteTx(
  tx: Prisma.TransactionClient,
  instituteId: string,
  atTime = new Date()
) {
  return tx.instituteBatchBuyAgreement.findFirst({
    where: {
      instituteId,
      status: "ACTIVE",
      acceptedAt: { not: null },
      effectiveFrom: { lte: atTime },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: atTime } }],
    },
    orderBy: [{ version: "desc" }],
  });
}

export function windowsOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null
): boolean {
  const aEndMs = aEnd ? aEnd.getTime() : Number.POSITIVE_INFINITY;
  const bEndMs = bEnd ? bEnd.getTime() : Number.POSITIVE_INFINITY;
  return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
}

/**
 * Resolves overlap between a newly activated agreement `[newFrom, newTo)` and existing
 * `ACTIVE` agreements without creating coverage gaps or overlapping active intervals.
 */
export async function reconcileOverlappingActiveAgreementsTx(
  tx: Prisma.TransactionClient,
  params: {
    instituteId: string;
    excludeAgreementId?: string;
    newFrom: Date;
    newTo: Date | null;
    now: Date;
  }
) {
  const activeList = await tx.instituteBatchBuyAgreement.findMany({
    where: {
      instituteId: params.instituteId,
      status: "ACTIVE",
      ...(params.excludeAgreementId ? { id: { not: params.excludeAgreementId } } : {}),
    },
    orderBy: [{ effectiveFrom: "asc" }, { version: "asc" }],
  });

  for (const prev of activeList) {
    if (!windowsOverlap(params.newFrom, params.newTo, prev.effectiveFrom, prev.effectiveTo)) {
      continue;
    }

    const prevEndMs = prev.effectiveTo ? prev.effectiveTo.getTime() : Number.POSITIVE_INFINITY;
    const newEndMs = params.newTo ? params.newTo.getTime() : Number.POSITIVE_INFINITY;

    // Disallow punching a finite mid-window inside a longer open/bounded active agreement
    if (params.newFrom > prev.effectiveFrom && newEndMs < prevEndMs) {
      throw new Error(
        `Agreement v${prev.version} covers beyond ${params.newTo?.toISOString()}. Use an open-ended takeover or terminate/adjust the window cleanly.`
      );
    }

    if (params.newFrom <= prev.effectiveFrom) {
      // New agreement starts at or before prev: fully supersede prev with zero active window
      await tx.instituteBatchBuyAgreement.update({
        where: { id: prev.id },
        data: {
          status: "SUPERSEDED",
          effectiveTo: prev.effectiveFrom,
        },
      });
    } else {
      // Truncate prev cleanly at newFrom; mark SUPERSEDED if already taken over as of now
      const takenOverNow = params.newFrom <= params.now;
      await tx.instituteBatchBuyAgreement.update({
        where: { id: prev.id },
        data: {
          status: takenOverNow ? "SUPERSEDED" : "ACTIVE",
          effectiveTo: params.newFrom,
        },
      });
    }
  }
}

async function assertNoOverlappingActiveAgreementsTx(
  tx: Prisma.TransactionClient,
  instituteId: string
) {
  const remainingActives = await tx.instituteBatchBuyAgreement.findMany({
    where: { instituteId, status: "ACTIVE" },
    orderBy: [{ effectiveFrom: "asc" }],
    select: { id: true, version: true, effectiveFrom: true, effectiveTo: true },
  });

  for (let i = 0; i < remainingActives.length; i++) {
    for (let j = i + 1; j < remainingActives.length; j++) {
      const a = remainingActives[i];
      const b = remainingActives[j];
      if (windowsOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)) {
        throw new Error(
          `Overlapping ACTIVE commercial agreement windows detected (v${a.version} vs v${b.version}).`
        );
      }
    }
  }
}

export async function saveInstituteBatchBuyAgreementCore(
  rawInput: SaveInstituteAgreementInput,
  adminUserId: string
) {
  const parsed = SaveInstituteAgreementSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid agreement configuration.",
    };
  }

  const input = parsed.data;
  const effectiveFrom = new Date(input.effectiveFrom);
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (Number.isNaN(effectiveFrom.getTime())) {
    return { success: false as const, error: "Invalid agreement effectiveFrom date." };
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom)) {
    return {
      success: false as const,
      error: "Agreement effectiveTo date must be strictly after effectiveFrom.",
    };
  }

  if (
    input.activateImmediately &&
    (!input.acceptedRepresentativeName?.trim() || !input.acceptedDesignation?.trim())
  ) {
    return {
      success: false as const,
      error:
        "Authorized institute representative name & designation are required for immediate activation.",
    };
  }

  const commissionRateStr = RATE_TIER_PERCENTAGE_MAP[input.rateTier];

  try {
    const agreement = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.$queryRaw`SELECT id FROM "Institute" WHERE id = ${input.instituteId} FOR UPDATE`;

        const institute = await tx.institute.findUnique({
          where: { id: input.instituteId },
          select: { id: true, name: true },
        });
        if (!institute) {
          throw new Error("Institute not found.");
        }

        const maxAgg = await tx.instituteBatchBuyAgreement.aggregate({
          where: { instituteId: input.instituteId },
          _max: { version: true },
        });
        const nextVersion = (maxAgg._max.version ?? 0) + 1;

        if (input.activateImmediately) {
          await reconcileOverlappingActiveAgreementsTx(tx, {
            instituteId: input.instituteId,
            newFrom: effectiveFrom,
            newTo: effectiveTo,
            now,
          });
        }

        const created = await tx.instituteBatchBuyAgreement.create({
          data: {
            instituteId: input.instituteId,
            version: nextVersion,
            status: input.activateImmediately ? "ACTIVE" : "DRAFT",
            rateTier: input.rateTier,
            commissionRatePct: new Prisma.Decimal(commissionRateStr),
            gstRatePct: new Prisma.Decimal(input.gstRatePct.toFixed(2)),
            gstTreatmentNote: input.gstTreatmentNote,
            sacCode: input.sacCode?.trim() || null,
            sacValidatedByCa: input.sacValidatedByCa,
            caValidatorName: input.sacValidatedByCa ? input.caValidatorName?.trim() || null : null,
            caMembershipNumber: input.sacValidatedByCa
              ? input.caMembershipNumber?.trim() || null
              : null,
            caValidatedAt: input.sacValidatedByCa ? now : null,
            caValidationNote: input.caValidationNote?.trim() || null,
            caValidationDocUrl: input.caValidationDocUrl?.trim() || null,
            attributionWindowDays: input.attributionWindowDays,
            holdingPeriodDays: input.holdingPeriodDays,
            paymentDueDays: input.paymentDueDays,
            commissionBaseRule: "SETTLED_TUITION_ONLY",
            cancellationClawbackPolicy: input.cancellationClawbackPolicy,
            effectiveFrom,
            effectiveTo,
            acceptedAt: input.activateImmediately ? now : null,
            acceptedById: input.activateImmediately ? adminUserId : null,
            acceptedRepresentativeName: input.activateImmediately
              ? input.acceptedRepresentativeName?.trim() || null
              : null,
            acceptedDesignation: input.activateImmediately
              ? input.acceptedDesignation?.trim() || null
              : null,
            createdById: adminUserId,
          },
        });

        if (input.activateImmediately) {
          await assertNoOverlappingActiveAgreementsTx(tx, input.instituteId);
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: input.instituteId,
          actorUserId: adminUserId,
          actorRole: "ADMIN",
          action: input.activateImmediately ? "AGREEMENT_ACTIVATED" : "AGREEMENT_DRAFT_CREATED",
          entityType: "InstituteBatchBuyAgreement",
          entityId: created.id,
          afterState: {
            version: created.version,
            status: created.status,
            rateTier: created.rateTier,
            commissionRatePct: created.commissionRatePct.toString(),
            gstRatePct: created.gstRatePct.toString(),
            holdingPeriodDays: created.holdingPeriodDays,
            sacCode: created.sacCode,
            sacValidatedByCa: created.sacValidatedByCa,
            caValidatorName: created.caValidatorName,
            caMembershipNumber: created.caMembershipNumber,
            effectiveFrom: created.effectiveFrom.toISOString(),
            effectiveTo: created.effectiveTo?.toISOString() ?? null,
          },
        });

        return created;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return {
      success: true as const,
      agreementId: agreement.id,
      version: agreement.version,
      status: agreement.status,
      instituteId: input.instituteId,
    };
  } catch (err: unknown) {
    console.error("Failed to save BatchBuy agreement:", err);
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to save BatchBuy commercial agreement.",
    };
  }
}

export async function acceptAndActivateAgreementCore(
  rawInput: {
    agreementId: string;
    acceptedRepresentativeName: string;
    acceptedDesignation: string;
  },
  actorUserId: string,
  actorRoleHint?: string
) {
  const parsed = AcceptInstituteAgreementSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues[0]?.message || "Invalid agreement acceptance details.",
    };
  }

  try {
    const activated = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const agreementMeta = await tx.instituteBatchBuyAgreement.findUnique({
          where: { id: parsed.data.agreementId },
          select: { id: true, instituteId: true },
        });
        if (!agreementMeta) {
          throw new Error("Agreement not found.");
        }

        await tx.$queryRaw`SELECT id FROM "Institute" WHERE id = ${agreementMeta.instituteId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "institute_batchbuy_agreement" WHERE id = ${agreementMeta.id} FOR UPDATE`;

        const agreement = await tx.instituteBatchBuyAgreement.findUnique({
          where: { id: agreementMeta.id },
        });
        if (!agreement) throw new Error("Agreement not found.");
        if (agreement.status !== "DRAFT") {
          throw new Error(`Agreement v${agreement.version} is already ${agreement.status}.`);
        }
        if (agreement.effectiveTo && agreement.effectiveTo <= now) {
          throw new Error("Agreement effective validity period has already expired.");
        }

        await reconcileOverlappingActiveAgreementsTx(tx, {
          instituteId: agreement.instituteId,
          excludeAgreementId: agreement.id,
          newFrom: agreement.effectiveFrom,
          newTo: agreement.effectiveTo,
          now,
        });

        const updated = await tx.instituteBatchBuyAgreement.update({
          where: { id: agreement.id },
          data: {
            status: "ACTIVE",
            acceptedAt: now,
            acceptedById: actorUserId,
            acceptedRepresentativeName: parsed.data.acceptedRepresentativeName.trim(),
            acceptedDesignation: parsed.data.acceptedDesignation.trim(),
          },
        });

        await assertNoOverlappingActiveAgreementsTx(tx, agreement.instituteId);

        const actorUser = await tx.user.findUnique({
          where: { id: actorUserId },
          select: { role: true },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: agreement.instituteId,
          actorUserId,
          actorRole: actorRoleHint || actorUser?.role || "INSTITUTE_MANAGER",
          action: "AGREEMENT_ACTIVATED",
          entityType: "InstituteBatchBuyAgreement",
          entityId: updated.id,
          beforeState: { status: "DRAFT" },
          afterState: {
            status: "ACTIVE",
            version: updated.version,
            commissionRatePct: updated.commissionRatePct.toString(),
            acceptedRepresentativeName: updated.acceptedRepresentativeName,
            acceptedDesignation: updated.acceptedDesignation,
            acceptedAt: now.toISOString(),
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 20000,
      }
    );

    return {
      success: true as const,
      agreementId: activated.id,
      instituteId: activated.instituteId,
      version: activated.version,
      commissionRatePct: Number(activated.commissionRatePct),
    };
  } catch (err: unknown) {
    console.error("Failed to accept BatchBuy agreement:", err);
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to accept commercial agreement.",
    };
  }
}
