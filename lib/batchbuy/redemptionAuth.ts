import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { Prisma } from "@/app/generated/prisma/client";

export interface CounterAuthResult {
  authorized: boolean;
  userId?: string;
  userName?: string;
  actorRole?: string;
  isIsmRole?: boolean;
  error?: string;
}

/**
 * Counter redemption authorization for BatchBuy Slice 4.
 * Explicitly permits Institute Managers, active Institute Members (MANAGER/ADMIN/SALES_MANAGER),
 * active Institute Sales Managers (InstituteSalesManagerAssignment), and Platform ADMINs.
 * Offer pricing & slab authoring remain restricted to Managers/Admins in slabActions.ts.
 */
export async function verifyCounterRedemptionAccess(
  instituteId: string
): Promise<CounterAuthResult> {
  if (!instituteId) {
    return { authorized: false, error: "Institute ID is required." };
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { authorized: false, error: "Please log in to continue." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return { authorized: false, error: "User account is inactive." };
  }

  if (user.role === "ADMIN") {
    return {
      authorized: true,
      userId: user.id,
      userName: user.name || "Platform Admin",
      actorRole: "ADMIN",
      isIsmRole: false,
    };
  }

  const [managerRecord, membership, ismAssignment] = await Promise.all([
    prisma.instituteManager.findUnique({
      where: {
        userId_instituteId: { userId: user.id, instituteId },
      },
      select: { userId: true },
    }),
    prisma.instituteMembership.findFirst({
      where: {
        userId: user.id,
        instituteId,
        status: "ACTIVE",
        isActive: true,
        role: { in: ["MANAGER", "ADMIN", "SALES_MANAGER"] },
      },
      select: { role: true },
    }),
    prisma.instituteSalesManagerAssignment.findUnique({
      where: {
        userId_instituteId: { userId: user.id, instituteId },
      },
      select: { isActive: true },
    }),
  ]);

  if (managerRecord || (membership && membership.role !== "SALES_MANAGER")) {
    return {
      authorized: true,
      userId: user.id,
      userName: user.name || "Institute Manager",
      actorRole: membership?.role || "INSTITUTE_MANAGER",
      isIsmRole: false,
    };
  }

  if (membership?.role === "SALES_MANAGER" || ismAssignment?.isActive) {
    return {
      authorized: true,
      userId: user.id,
      userName: user.name || "Institute Sales Manager",
      actorRole: "INSTITUTE_SALES_MANAGER",
      isIsmRole: true,
    };
  }

  return {
    authorized: false,
    userId: user.id,
    error: "Access denied. Only authorized institute counter staff or sales managers can verify vouchers.",
  };
}

/**
 * Strictly authorizes AcademyFind Platform ADMIN users for commercial agreement
 * governance, anti-bypass attribution adjudication, and B2B commission invoicing.
 */
export async function verifyPlatformAdminAccess(): Promise<{
  authorized: boolean;
  userId?: string;
  userName?: string;
  error?: string;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { authorized: false, error: "Authentication required." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true, isActive: true },
  });

  if (!user || !user.isActive || user.role !== "ADMIN") {
    return {
      authorized: false,
      userId: session.user.id,
      error: "Access denied. Platform Administrator permissions required.",
    };
  }

  return {
    authorized: true,
    userId: user.id,
    userName: user.name || "Platform Admin",
  };
}

/**
 * Appends an immutable entry to BatchBuyAuditLog inside an active Prisma transaction.
 */
export async function writeBatchBuyAuditLogTx(
  tx: Prisma.TransactionClient,
  params: {
    instituteId?: string | null;
    actorUserId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: Prisma.InputJsonValue | null;
    afterState?: Prisma.InputJsonValue | null;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  }
) {
  return tx.batchBuyAuditLog.create({
    data: {
      instituteId: params.instituteId ?? null,
      instituteIdSnapshot: params.instituteId ?? null,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeState: params.beforeState ?? Prisma.JsonNull,
      afterState: params.afterState ?? Prisma.JsonNull,
      reason: params.reason ?? null,
      metadata: params.metadata ?? Prisma.JsonNull,
    },
  });
}

/**
 * Resolves the highest applicable active lower-tier slab percentage matching `confirmedCount`.
 * Never resurrects archived/replaced slabs, and enforces strict batch-override scope precedence
 * (when any active batch override exists, never silently falls back to institute-wide defaults).
 */
export async function resolveQualifyingLowerSlabPctTx(
  tx: Prisma.TransactionClient,
  params: {
    instituteId: string;
    batchId: string;
    confirmedCount: number;
    offerPublishedAt?: Date | null;
  }
): Promise<number | null> {
  const activeBatchOverrides = await tx.groupDiscountSlab.findMany({
    where: {
      instituteId: params.instituteId,
      batchId: params.batchId,
      isActive: true,
      isArchived: false,
    },
    orderBy: [{ discountPercentage: "desc" }],
    select: {
      minStudents: true,
      maxStudents: true,
      discountPercentage: true,
    },
  });

  // Strict scope rule: if this batch has >= 1 active override slab, ONLY those batch slabs apply.
  const scopePool =
    activeBatchOverrides.length > 0
      ? activeBatchOverrides
      : await tx.groupDiscountSlab.findMany({
          where: {
            instituteId: params.instituteId,
            batchId: null,
            isActive: true,
            isArchived: false,
          },
          orderBy: [{ discountPercentage: "desc" }],
          select: {
            minStudents: true,
            maxStudents: true,
            discountPercentage: true,
          },
        });

  for (const s of scopePool) {
    const withinMax = s.maxStudents === null || params.confirmedCount <= s.maxStudents;
    if (params.confirmedCount >= s.minStudents && withinMax) {
      return Number(s.discountPercentage);
    }
  }

  return null;
}
