"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/app/generated/prisma/client";
import { verifyInstituteManagerAccess } from "./slabActions";
import { verifyPlatformAdminAccess } from "./redemptionAuth";
import type { SaveInstituteAgreementInput } from "./commissionMath";
import {
  getActiveAgreementForInstituteTx as getActiveAgreementTxCore,
  saveInstituteBatchBuyAgreementCore,
  acceptAndActivateAgreementCore,
} from "./core/agreementCore";

export async function getActiveAgreementForInstituteTx(
  tx: Prisma.TransactionClient,
  instituteId: string,
  atTime = new Date()
) {
  return getActiveAgreementTxCore(tx, instituteId, atTime);
}

/**
 * Platform ADMIN creates a new versioned BatchBuy Commercial Agreement (2%, 3%, or 4%).
 * Preserves all historical agreement versions cleanly.
 */
export async function saveInstituteBatchBuyAgreementAction(
  rawInput: SaveInstituteAgreementInput
) {
  const adminCheck = await verifyPlatformAdminAccess();
  if (!adminCheck.authorized || !adminCheck.userId) {
    return { success: false, error: adminCheck.error || "Admin permissions required." };
  }

  const outcome = await saveInstituteBatchBuyAgreementCore(rawInput, adminCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/offers`);
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

/**
 * Allows an authorized Institute Manager (or Admin) to sign and activate a DRAFT commercial
 * agreement, superseding older overlapping active agreements without mutating prior offers.
 */
export async function acceptAndActivateAgreementAction(rawInput: {
  agreementId: string;
  acceptedRepresentativeName: string;
  acceptedDesignation: string;
}) {
  const agreementId = rawInput?.agreementId;
  if (!agreementId) {
    return { success: false, error: "Agreement ID is required." };
  }

  const lookup = await prisma.instituteBatchBuyAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, instituteId: true },
  });
  if (!lookup) {
    return { success: false, error: "Agreement not found." };
  }

  const authCheck = await verifyInstituteManagerAccess(lookup.instituteId);
  if (!authCheck.authorized || !authCheck.userId) {
    return {
      success: false,
      error: authCheck.error || "Only authorized Institute Managers or Admins can accept agreements.",
    };
  }

  const outcome = await acceptAndActivateAgreementCore(rawInput, authCheck.userId);
  if (outcome.success) {
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/offers`);
    revalidatePath(`/manager/${outcome.instituteId}/batchbuy/redemptions`);
  }
  return outcome;
}

export async function getInstituteAgreementsSummary(instituteId: string) {
  const now = new Date();
  const agreements = await prisma.instituteBatchBuyAgreement.findMany({
    where: { instituteId },
    orderBy: [{ version: "desc" }],
    select: {
      id: true,
      version: true,
      status: true,
      rateTier: true,
      commissionRatePct: true,
      gstRatePct: true,
      gstTreatmentNote: true,
      sacCode: true,
      sacValidatedByCa: true,
      caValidatorName: true,
      caMembershipNumber: true,
      caValidatedAt: true,
      caValidationNote: true,
      caValidationDocUrl: true,
      attributionWindowDays: true,
      holdingPeriodDays: true,
      paymentDueDays: true,
      commissionBaseRule: true,
      cancellationClawbackPolicy: true,
      effectiveFrom: true,
      effectiveTo: true,
      acceptedAt: true,
      acceptedRepresentativeName: true,
      acceptedDesignation: true,
      createdAt: true,
    },
  });

  const active =
    agreements.find(
      (a) =>
        a.status === "ACTIVE" &&
        a.acceptedAt !== null &&
        a.effectiveFrom <= now &&
        (a.effectiveTo === null || a.effectiveTo > now)
    ) ?? null;

  return {
    hasActiveAgreement: Boolean(active),
    activeAgreement: active
      ? {
          ...active,
          commissionRatePct: Number(active.commissionRatePct),
          gstRatePct: Number(active.gstRatePct),
          effectiveFrom: active.effectiveFrom.toISOString(),
          effectiveTo: active.effectiveTo ? active.effectiveTo.toISOString() : null,
          caValidatedAt: active.caValidatedAt ? active.caValidatedAt.toISOString() : null,
          acceptedAt: active.acceptedAt ? active.acceptedAt.toISOString() : null,
          createdAt: active.createdAt.toISOString(),
        }
      : null,
    history: agreements.map((a) => ({
      ...a,
      commissionRatePct: Number(a.commissionRatePct),
      gstRatePct: Number(a.gstRatePct),
      effectiveFrom: a.effectiveFrom.toISOString(),
      effectiveTo: a.effectiveTo ? a.effectiveTo.toISOString() : null,
      caValidatedAt: a.caValidatedAt ? a.caValidatedAt.toISOString() : null,
      acceptedAt: a.acceptedAt ? a.acceptedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
