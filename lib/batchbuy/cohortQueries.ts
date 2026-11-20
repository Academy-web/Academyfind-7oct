import { prisma } from "@/lib/prisma";
import { CohortMemberStage, CohortStatus, Prisma } from "@/app/generated/prisma/client";
import { resolveEffectiveDiscountSlabs, SlabResolutionResult } from "./slabResolver";
import {
  CohortSlabProgress,
  computeCohortSlabProgress,
  formatPublicMemberName,
  maskPhone,
  resolveMemberIntentState,
} from "./cohortValidation";

export type { CohortSlabProgress };
export { computeCohortSlabProgress };

export interface PublicCohortMemberDTO {
  id: string;
  displayName: string;
  username: string | null;
  image: string | null;
  city: string | null;
  stage: CohortMemberStage;
  phoneVerified: boolean;
  profileConfirmed: boolean;
  hasExplicitIntent: boolean;
  isMinor: boolean;
  isCreator: boolean;
  joinedAt: string;
}

export interface PublicCohortCardDTO {
  id: string;
  cohortCode: string;
  title: string;
  examCategory: string;
  targetAcademicYear: number;
  status: CohortStatus;
  targetSize: number;
  minRequired: number;
  maxCapacity: number;
  activeMemberCount: number;
  verifiedMemberCount: number;
  formingExpiresAt: string;
  createdAt: string;
  institute: {
    id: string;
    slug: string | null;
    name: string;
    logo: string | null;
    cityName: string;
    citySlug: string | null;
    verified: boolean;
  };
  batch: {
    id: string;
    name: string;
    courseName: string | null;
    fee: number | null;
    originalFee: number | null;
    mode: string;
    academicYear: string | null;
  };
  slabResolution: SlabResolutionResult;
  slabProgress: CohortSlabProgress;
}

export interface CurrentUserCohortState {
  isLoggedIn: boolean;
  userId: string;
  isMember: boolean;
  isCreator: boolean;
  stage: CohortMemberStage | null;
  memberPhoneVerified: boolean;
  accountPhoneVerified: boolean;
  accountPhoneMasked: string | null;
  profilePrefill: {
    targetExam: string | null;
    targetYear: number | null;
    currentClass: string | null;
  };
}

export interface PublicCohortDetailDTO extends PublicCohortCardDTO {
  conversationId: string | null;
  admissionDeadlineAt: string | null;
  members: PublicCohortMemberDTO[];
  currentUserState: CurrentUserCohortState | null;
}

export interface CohortDiscoveryFilters {
  examCategory?: string;
  city?: string;
  targetAcademicYear?: number;
  status?: CohortStatus | "ALL_ACTIVE";
  search?: string;
  instituteId?: string;
  limit?: number;
}

const ACTIVE_MEMBER_STAGES: CohortMemberStage[] = [
  "INTERESTED",
  "INTENT_VERIFIED",
  "OFFER_ACCEPTED",
  "VOUCHER_ISSUED",
  "ENROLLED_AT_CENTER",
];

/**
 * Fetches publicly discoverable BatchBuy cohorts with resolved slab ladders
 * and privacy-safe member counts (zero student PII exposed).
 */
export async function getPublicCohorts(
  filters: CohortDiscoveryFilters = {}
): Promise<PublicCohortCardDTO[]> {
  const {
    examCategory,
    city,
    targetAcademicYear,
    status = "ALL_ACTIVE",
    search,
    instituteId,
    limit = 24,
  } = filters;

  const whereClause: Prisma.GroupAdmissionCohortWhereInput = {};

  if (status === "ALL_ACTIVE") {
    whereClause.status = { in: ["FORMING", "OFFER_PENDING", "OFFER_ACTIVE", "ADMISSION_OPEN"] };
    // Exclude FORMING cohorts whose window has already elapsed even if status cron hasn't swept yet
    whereClause.AND = [
      {
        OR: [
          { status: { not: "FORMING" } },
          { formingExpiresAt: { gt: new Date() } },
        ],
      },
    ];
  } else if (status) {
    whereClause.status = status;
  }

  if (examCategory && examCategory !== "ALL") {
    whereClause.examCategory = { equals: examCategory, mode: "insensitive" };
  }

  if (targetAcademicYear) {
    whereClause.targetAcademicYear = targetAcademicYear;
  }

  if (instituteId) {
    whereClause.instituteId = instituteId;
  }

  if (city && city !== "ALL") {
    whereClause.institute = {
      city: {
        OR: [
          { slug: { equals: city, mode: "insensitive" } },
          { name: { contains: city, mode: "insensitive" } },
        ],
      },
    };
  }

  if (search && search.trim()) {
    const q = search.trim();
    whereClause.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { cohortCode: { contains: q, mode: "insensitive" } },
      { examCategory: { contains: q, mode: "insensitive" } },
      { institute: { name: { contains: q, mode: "insensitive" } } },
      { batch: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const cohorts = await prisma.groupAdmissionCohort.findMany({
    where: whereClause,
    take: Math.min(limit, 50),
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      institute: {
        select: {
          id: true,
          slug: true,
          name: true,
          logo: true,
          isVerified: true,
          city: { select: { name: true, slug: true } },
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          courseName: true,
          fee: true,
          originalFee: true,
          mode: true,
          academicYear: true,
        },
      },
      members: {
        where: { stage: { in: ACTIVE_MEMBER_STAGES } },
        select: {
          id: true,
          stage: true,
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: true,
        },
      },
    },
  });

  // Resolve slabs in parallel per unique (instituteId, batchId) pair
  const slabCache = new Map<string, SlabResolutionResult>();
  await Promise.all(
    Array.from(new Set(cohorts.map((c) => `${c.instituteId}::${c.batchId}`))).map(async (key) => {
      const [instId, batchId] = key.split("::");
      const res = await resolveEffectiveDiscountSlabs(instId, batchId);
      slabCache.set(key, res);
    })
  );

  return cohorts.map((cohort) => {
    const activeMemberCount = cohort.members.length;
    const verifiedMemberCount = cohort.members.filter(
      (m) => resolveMemberIntentState(m).isFullyIntentVerified
    ).length;
    const slabResolution = slabCache.get(`${cohort.instituteId}::${cohort.batchId}`) || {
      scope: "NONE",
      slabs: [],
    };
    const slabProgress = computeCohortSlabProgress(activeMemberCount, slabResolution.slabs);

    return {
      id: cohort.id,
      cohortCode: cohort.cohortCode,
      title: cohort.title,
      examCategory: cohort.examCategory,
      targetAcademicYear: cohort.targetAcademicYear,
      status: cohort.status,
      targetSize: cohort.targetSize,
      minRequired: cohort.minRequired,
      maxCapacity: cohort.maxCapacity,
      activeMemberCount,
      verifiedMemberCount,
      formingExpiresAt: cohort.formingExpiresAt.toISOString(),
      createdAt: cohort.createdAt.toISOString(),
      institute: {
        id: cohort.institute.id,
        slug: cohort.institute.slug,
        name: cohort.institute.name,
        logo: cohort.institute.logo,
        cityName: cohort.institute.city?.name || "All India",
        citySlug: cohort.institute.city?.slug || "all-india",
        verified: cohort.institute.isVerified,
      },
      batch: {
        id: cohort.batch.id,
        name: cohort.batch.name,
        courseName: cohort.batch.courseName,
        fee: cohort.batch.fee,
        originalFee: cohort.batch.originalFee,
        mode: cohort.batch.mode,
        academicYear: cohort.batch.academicYear,
      },
      slabResolution,
      slabProgress,
    };
  });
}

/**
 * Fetches full details for a single BatchBuy cohort by its `cohortCode`.
 * Strictly strips student PII (phones, emails, parental details) from the roster.
 */
export async function getCohortDetailsByCode(
  cohortCode: string,
  viewerUserId?: string | null
): Promise<PublicCohortDetailDTO | null> {
  const normalizedCode = cohortCode.trim().toUpperCase();

  const cohort = await prisma.groupAdmissionCohort.findUnique({
    where: { cohortCode: normalizedCode },
    include: {
      institute: {
        select: {
          id: true,
          slug: true,
          name: true,
          logo: true,
          isVerified: true,
          city: { select: { name: true, slug: true } },
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          courseName: true,
          fee: true,
          originalFee: true,
          mode: true,
          academicYear: true,
        },
      },
      members: {
        where: { stage: { in: ACTIVE_MEMBER_STAGES } },
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          userId: true,
          stage: true,
          phoneVerified: true,
          profileConfirmed: true,
          explicitIntentAt: true,
          isMinor: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
              studentProfile: {
                select: {
                  city: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cohort) return null;

  const slabResolution = await resolveEffectiveDiscountSlabs(cohort.instituteId, cohort.batchId);
  const activeMemberCount = cohort.members.length;
  const verifiedMemberCount = cohort.members.filter(
    (m) => resolveMemberIntentState(m).isFullyIntentVerified
  ).length;
  const slabProgress = computeCohortSlabProgress(activeMemberCount, slabResolution.slabs);

  const members: PublicCohortMemberDTO[] = cohort.members.map((m) => ({
    id: m.id,
    displayName: formatPublicMemberName(m.user.name, m.user.username),
    username: m.user.username,
    image: m.user.image,
    city: m.user.studentProfile?.city || null,
    stage: m.stage,
    phoneVerified: m.phoneVerified,
    profileConfirmed: m.profileConfirmed,
    hasExplicitIntent: Boolean(m.explicitIntentAt),
    isMinor: m.isMinor,
    isCreator: m.userId === cohort.createdById,
    joinedAt: m.joinedAt.toISOString(),
  }));

  let currentUserState: CurrentUserCohortState | null = null;

  if (viewerUserId) {
    const viewer = await prisma.user.findUnique({
      where: { id: viewerUserId },
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
        studentProfile: {
          select: {
            targetExam: true,
            targetYear: true,
            currentClass: true,
          },
        },
      },
    });

    if (viewer) {
      const myMember = cohort.members.find((m) => m.userId === viewer.id);
      currentUserState = {
        isLoggedIn: true,
        userId: viewer.id,
        isMember: Boolean(myMember),
        isCreator: cohort.createdById === viewer.id,
        stage: myMember?.stage || null,
        memberPhoneVerified: myMember?.phoneVerified || false,
        accountPhoneVerified: viewer.phoneVerified,
        accountPhoneMasked: maskPhone(viewer.phone),
        profilePrefill: {
          targetExam: viewer.studentProfile?.targetExam || null,
          targetYear: viewer.studentProfile?.targetYear || null,
          currentClass: viewer.studentProfile?.currentClass || null,
        },
      };
    }
  }

  return {
    id: cohort.id,
    cohortCode: cohort.cohortCode,
    title: cohort.title,
    examCategory: cohort.examCategory,
    targetAcademicYear: cohort.targetAcademicYear,
    status: cohort.status,
    targetSize: cohort.targetSize,
    minRequired: cohort.minRequired,
    maxCapacity: cohort.maxCapacity,
    activeMemberCount,
    verifiedMemberCount,
    formingExpiresAt: cohort.formingExpiresAt.toISOString(),
    admissionDeadlineAt: cohort.admissionDeadlineAt?.toISOString() || null,
    createdAt: cohort.createdAt.toISOString(),
    conversationId: currentUserState?.isMember ? cohort.conversationId : null,
    institute: {
      id: cohort.institute.id,
      slug: cohort.institute.slug,
      name: cohort.institute.name,
      logo: cohort.institute.logo,
      cityName: cohort.institute.city?.name || "All India",
      citySlug: cohort.institute.city?.slug || "all-india",
      verified: cohort.institute.isVerified,
    },
    batch: {
      id: cohort.batch.id,
      name: cohort.batch.name,
      courseName: cohort.batch.courseName,
      fee: cohort.batch.fee,
      originalFee: cohort.batch.originalFee,
      mode: cohort.batch.mode,
      academicYear: cohort.batch.academicYear,
    },
    slabResolution,
    slabProgress,
    members,
    currentUserState,
  };
}

/**
 * Fetches active cohorts + institute-wide slabs for the Institute Profile BatchBuy widget.
 */
export async function getInstituteBatchBuyOverview(instituteId: string) {
  const [cohorts, instituteDefaultSlabs, activeBatches] = await Promise.all([
    getPublicCohorts({ instituteId, status: "ALL_ACTIVE", limit: 12 }),
    resolveEffectiveDiscountSlabs(instituteId, null),
    prisma.instituteBatch.findMany({
      where: { instituteId, isActive: true },
      select: {
        id: true,
        name: true,
        courseName: true,
        academicYear: true,
        fee: true,
        originalFee: true,
        mode: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    cohorts,
    instituteDefaultSlabs,
    activeBatches,
  };
}

export interface SearchInstituteBatchOption {
  id: string;
  name: string;
  slug: string | null;
  cityName: string;
  logo: string | null;
  verified: boolean;
  batches: Array<{
    id: string;
    name: string;
    courseName: string | null;
    academicYear: string | null;
    fee: number | null;
    mode: string;
  }>;
  hasSlabs: boolean;
}

/**
 * Searches published institutes that have active batches for cohort creation.
 */
export async function searchInstitutesForCohortCreation(
  query: string = ""
): Promise<SearchInstituteBatchOption[]> {
  const q = query.trim();

  const institutes = await prisma.institute.findMany({
    where: {
      isActive: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { city: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    take: 25,
    orderBy: [{ discountSlabs: { _count: "desc" } }, { isVerified: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      isVerified: true,
      city: { select: { name: true } },
      batches: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          courseName: true,
          academicYear: true,
          fee: true,
          mode: true,
        },
        orderBy: { name: "asc" },
      },
      _count: {
        select: {
          discountSlabs: {
            where: { isActive: true, isArchived: false },
          },
        },
      },
    },
  });

  return institutes.map((inst) => ({
    id: inst.id,
    name: inst.name,
    slug: inst.slug,
    cityName: inst.city?.name || "All India",
    logo: inst.logo,
    verified: inst.isVerified,
    batches: inst.batches,
    hasSlabs: inst._count.discountSlabs > 0,
  }));
}
