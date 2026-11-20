"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/prisma";
import { CohortMemberStage, Prisma } from "@/app/generated/prisma/client";
import { notifyUser } from "@/lib/notifications/notify";
import { writeBatchBuyAuditLogTx } from "./redemptionAuth";
import { resolveEffectiveDiscountSlabs } from "./slabResolver";
import {
  CreateCohortInput,
  CreateCohortInputSchema,
  formatPublicMemberName,
  generateCohortCodeCandidate,
  JoinCohortInput,
  JoinCohortInputSchema,
  normalizeIndianPhone,
  resolveMemberIntentState,
} from "./cohortValidation";
import {
  getCohortDetailsByCode,
  searchInstitutesForCohortCreation,
} from "./cohortQueries";

const ACTIVE_MEMBER_STAGES: CohortMemberStage[] = [
  "INTERESTED",
  "INTENT_VERIFIED",
  "OFFER_ACCEPTED",
  "VOUCHER_ISSUED",
  "ENROLLED_AT_CENTER",
];

function getInstituteProperSlug(id: string, slug: string | null | undefined) {
  return slug ? `${id}-${slug}` : id;
}

/**
 * Search helper for the client Create Cohort drawer/modal.
 */
export async function searchInstitutesAction(query: string) {
  try {
    const results = await searchInstitutesForCohortCreation(query);
    return { success: true, institutes: results };
  } catch (err) {
    console.error("Failed to search institutes for cohort:", err);
    return { success: false, institutes: [], error: "Unable to load institutes." };
  }
}

/**
 * Fetches effective BatchBuy discount slabs & fallback policy for a selected institute + batch.
 */
export async function getSlabsForCohortSetupAction(instituteId: string, batchId?: string | null) {
  try {
    const resolution = await resolveEffectiveDiscountSlabs(instituteId, batchId);
    return { success: true, resolution };
  } catch (err) {
    console.error("Failed to resolve slabs:", err);
    return {
      success: false,
      resolution: { scope: "NONE" as const, slabs: [] },
    };
  }
}

/**
 * Creates a new BatchBuy student admission cohort, links a dedicated Study/Group Conversation,
 * enrolls the creator with 3-level intent verification state, and notifies institute managers.
 */
export async function createBatchBuyCohort(rawInput: CreateCohortInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Please sign in to start a BatchBuy cohort.",
      requiresAuth: true,
    };
  }

  const parsed = CreateCohortInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const {
    instituteId,
    batchId,
    customBatchName,
    title,
    examCategory,
    targetAcademicYear,
    minRequired,
    targetSize,
    maxCapacity,
    formingDays,
    intent,
  } = parsed.data;

  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      isActive: true,
      phoneVerified: true,
    },
  });

  if (!user || !user.isActive) {
    return { success: false, error: "Your account is inactive or unavailable." };
  }

  const institute = await prisma.institute.findUnique({
    where: { id: instituteId },
    select: {
      id: true,
      name: true,
      slug: true,
      city: { select: { name: true } },
      managers: { select: { userId: true } },
    },
  });

  if (!institute) {
    return { success: false, error: "Selected institute was not found." };
  }

  let batch = null;
  if (batchId && !batchId.startsWith("__")) {
    batch = await prisma.instituteBatch.findFirst({
      where: { id: batchId, instituteId, isActive: true },
      select: { id: true, name: true },
    });
  }

  if (!batch) {
    // Generate appropriate batch name for auto or demand cohorts
    let batchName = customBatchName?.trim();
    if (!batchName) {
      if (batchId === "__auto_dropper__") {
        batchName = `${examCategory} Droppers Batch (${targetAcademicYear})`;
      } else if (batchId === "__auto_foundation__") {
        batchName = `${examCategory} Foundation Batch (${targetAcademicYear})`;
      } else if (batchId === "__auto_crash__") {
        batchName = `${examCategory} Crash Course (${targetAcademicYear})`;
      } else {
        batchName = `${examCategory} Classroom Program (${targetAcademicYear})`;
      }
    }

    batch = await prisma.instituteBatch.findFirst({
      where: { instituteId, name: batchName, isActive: true },
      select: { id: true, name: true },
    });

    if (!batch) {
      batch = await prisma.instituteBatch.create({
        data: {
          instituteId,
          name: batchName,
          courseName: examCategory,
          academicYear: String(targetAcademicYear),
          isActive: true,
          mode: "OFFLINE",
        },
        select: { id: true, name: true },
      });
    }
  }

  const resolvedBatchId = batch.id;
  const resolvedBatchName = batch.name;

  const normalizedParentPhone = intent.isMinor
    ? normalizeIndianPhone(intent.parentPhone)
    : null;

  const now = new Date();
  const formingExpiresAt = new Date(now.getTime() + formingDays * 24 * 60 * 60 * 1000);
  const publicCreatorName = formatPublicMemberName(user.name, user.username);
  const intentState = resolveMemberIntentState({
    phoneVerified: user.phoneVerified,
    profileConfirmed: true,
    explicitIntentAt: intent.confirmIntent ? now : null,
  });
  const initialStage: CohortMemberStage = intentState.stage;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Lock the User row inside Serializable tx so simultaneous create/join requests by
        // the same student across different cohorts for the same batch are strictly serialized.
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;

        // Duplicate guard inside locked transaction
        const existingSameBatchMembership = await tx.groupCohortMember.findFirst({
          where: {
            userId,
            stage: { in: ACTIVE_MEMBER_STAGES },
            cohort: {
              instituteId,
              batchId: resolvedBatchId,
              status: { in: ["FORMING", "OFFER_PENDING", "OFFER_ACTIVE", "ADMISSION_OPEN"] },
            },
          },
          select: {
            cohort: { select: { cohortCode: true } },
          },
        });

        if (existingSameBatchMembership) {
          return {
            duplicateCohortCode: existingSameBatchMembership.cohort.cohortCode,
          };
        }

        // Generate collision-free cohortCode
        let cohortCode = "";
        for (let attempt = 0; attempt < 6; attempt++) {
          const candidate = generateCohortCodeCandidate(institute.name, institute.city?.name || "All India");
          const taken = await tx.groupAdmissionCohort.findUnique({
            where: { cohortCode: candidate },
            select: { id: true },
          });
          if (!taken) {
            cohortCode = candidate;
            break;
          }
        }
        if (!cohortCode) {
          throw new Error("Could not generate a unique cohort code. Please try again.");
        }

        // Sync user's StudentProfile fields for Level 2 verification
        await tx.studentProfile.upsert({
          where: { userId },
          create: {
            userId,
            targetExam: intent.targetExam,
            targetYear: intent.targetAcademicYear,
            currentClass: intent.currentClass,
          },
          update: {
            targetExam: intent.targetExam,
            targetYear: intent.targetAcademicYear,
            currentClass: intent.currentClass,
          },
        });

        // Create dedicated private Conversation reusing AcademyFind's chat infrastructure
        // NOTE: isStudyGroup=false prevents exposure in public study-group endpoints;
        // channelType is omitted (null) so @@unique([instituteId, channelType]) allows multiple cohorts.
        const conversation = await tx.conversation.create({
          data: {
            type: "GROUP",
            isStudyGroup: false,
            instituteId,
            batchId: resolvedBatchId,
            title,
            examCategory,
            city: institute.city?.name || "All India",
            description: `BatchBuy Cohort ${cohortCode} for ${institute.name} (${resolvedBatchName})`,
            createdById: userId,
            visibility: "PRIVATE",
            memberCount: 1,
            maxMembers: maxCapacity,
            isReadOnly: false,
            lastMessageAt: now,
            lastActivityAt: now,
          },
        });

        const cohort = await tx.groupAdmissionCohort.create({
          data: {
            cohortCode,
            title,
            instituteId,
            batchId: resolvedBatchId,
            examCategory,
            targetAcademicYear,
            minRequired,
            targetSize,
            maxCapacity,
            status: "FORMING",
            formingExpiresAt,
            createdById: userId,
            conversationId: conversation.id,
          },
        });

        await tx.groupCohortMember.create({
          data: {
            cohortId: cohort.id,
            userId,
            stage: initialStage,
            phoneVerified: intentState.hasPhoneVerification,
            profileConfirmed: intentState.hasCourseConfirmation,
            explicitIntentAt: intentState.hasExplicitIntent ? now : null,
            isMinor: intent.isMinor,
            parentName: intent.isMinor ? intent.parentName?.trim() || null : null,
            parentPhone: normalizedParentPhone,
            parentNotifiedAt: null,
            parentConsentVerifiedAt: null,
            parentConsentMethod: null,
          },
        });

        await tx.conversationParticipant.create({
          data: {
            conversationId: conversation.id,
            userId,
            role: "ADMIN",
            status: "ACTIVE",
          },
        });

        const welcomeMsg = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: userId,
            type: "SYSTEM",
            content: `${publicCreatorName} started BatchBuy cohort ${cohortCode} for ${institute.name} — ${batch.name}. Target: ${targetSize} students.`,
          },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageId: welcomeMsg.id },
        });

        await writeBatchBuyAuditLogTx(tx, {
          instituteId,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "COHORT_CREATED",
          entityType: "GroupAdmissionCohort",
          entityId: cohort.id,
          afterState: {
            cohortCode: cohort.cohortCode,
            batchId,
            minRequired,
            targetSize,
            maxCapacity,
          },
        });

        return {
          duplicateCohortCode: null,
          cohortId: cohort.id,
          cohortCode: cohort.cohortCode,
          conversationId: conversation.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (result.duplicateCohortCode) {
      return {
        success: false,
        error: `You are already in an active cohort (${result.duplicateCohortCode}) for this batch.`,
        existingCohortCode: result.duplicateCohortCode,
      };
    }

    // Notify institute managers asynchronously
    await Promise.all(
      institute.managers.map((mgr) =>
        notifyUser(
          mgr.userId,
          "SYSTEM",
          `New BatchBuy Cohort Started: ${result.cohortCode}`,
          `${publicCreatorName} started a group admission cohort for ${batch.name} (target: ${targetSize} students).`,
          result.cohortId!
        )
      )
    );

    const properSlug = getInstituteProperSlug(institute.id, institute.slug);
    revalidatePath("/batchbuy");
    revalidatePath(`/batchbuy/${result.cohortCode}`);
    revalidatePath(`/institute/${properSlug}`);

    return {
      success: true,
      cohortId: result.cohortId,
      cohortCode: result.cohortCode,
      conversationId: result.conversationId,
      stage: initialStage,
      message: "Your BatchBuy cohort is live! Share the invite link to unlock group discounts.",
    };
  } catch (err: unknown) {
    console.error("Failed to create BatchBuy cohort:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return {
        success: false,
        error: "High concurrency detected while creating cohort. Please try again.",
      };
    }
    const msg = err instanceof Error ? err.message : "Could not create BatchBuy cohort.";
    return { success: false, error: msg };
  }
}

/**
 * Joins an existing BatchBuy cohort with concurrency-safe capacity locking,
 * 3-level intent capture, DPDPA minor details, and automatic Conversation enrollment.
 */
export async function joinBatchBuyCohort(rawInput: JoinCohortInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Please sign in to join this BatchBuy cohort.",
      requiresAuth: true,
    };
  }

  const parsed = JoinCohortInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }

  const { cohortId, intent } = parsed.data;
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      isActive: true,
      phoneVerified: true,
    },
  });

  if (!user || !user.isActive) {
    return { success: false, error: "Your account is inactive or unavailable." };
  }

  const normalizedParentPhone = intent.isMinor
    ? normalizeIndianPhone(intent.parentPhone)
    : null;
  const now = new Date();
  const publicMemberName = formatPublicMemberName(user.name, user.username);
  const intentState = resolveMemberIntentState({
    phoneVerified: user.phoneVerified,
    profileConfirmed: true,
    explicitIntentAt: intent.confirmIntent ? now : null,
  });
  const targetStage: CohortMemberStage = intentState.stage;

  try {
    const txOutcome = await prisma.$transaction(
      async (tx) => {
        // Consistent lock ordering ("user" -> "group_admission_cohort") prevents AB-BA deadlocks
        // and serializes simultaneous joins by the same user across different cohorts for the same batch.
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;

        // Row-level lock on cohort to prevent capacity overflow from simultaneous joins
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${cohortId} FOR UPDATE`;

        const cohort = await tx.groupAdmissionCohort.findUnique({
          where: { id: cohortId },
          include: {
            institute: { select: { id: true, slug: true, name: true } },
            batch: { select: { id: true, name: true } },
            members: {
              select: {
                id: true,
                userId: true,
                stage: true,
              },
            },
          },
        });

        if (!cohort) {
          throw new Error("Cohort not found.");
        }

        if (cohort.status !== "FORMING") {
          throw new Error("This cohort is no longer accepting new forming members.");
        }

        if (cohort.formingExpiresAt <= now) {
          await tx.groupAdmissionCohort.update({
            where: { id: cohortId },
            data: { status: "EXPIRED" },
          });
          return {
            expired: true as const,
            cohortCode: cohort.cohortCode,
            instituteId: cohort.institute.id,
            instituteSlug: cohort.institute.slug,
          };
        }

        const existingMembership = cohort.members.find((m) => m.userId === userId);
        if (existingMembership && existingMembership.stage !== "DROPPED") {
          throw new Error("You are already a member of this BatchBuy cohort.");
        }

        const activeCount = cohort.members.filter((m) => m.stage !== "DROPPED").length;
        if (activeCount >= cohort.maxCapacity) {
          throw new Error(
            `This cohort has reached its maximum capacity of ${cohort.maxCapacity} students.`
          );
        }

        // Duplicate guard across other active cohorts for the same batch (serialized via user FOR UPDATE lock)
        const otherActiveCohort = await tx.groupCohortMember.findFirst({
          where: {
            userId,
            cohortId: { not: cohortId },
            stage: { in: ACTIVE_MEMBER_STAGES },
            cohort: {
              instituteId: cohort.instituteId,
              batchId: cohort.batchId,
              status: { in: ["FORMING", "OFFER_PENDING", "OFFER_ACTIVE", "ADMISSION_OPEN"] },
            },
          },
          select: { cohort: { select: { cohortCode: true } } },
        });

        if (otherActiveCohort) {
          throw new Error(
            `You are already participating in cohort ${otherActiveCohort.cohort.cohortCode} for this same batch.`
          );
        }

        // Update StudentProfile Level 2 confirmation
        await tx.studentProfile.upsert({
          where: { userId },
          create: {
            userId,
            targetExam: intent.targetExam,
            targetYear: intent.targetAcademicYear,
            currentClass: intent.currentClass,
          },
          update: {
            targetExam: intent.targetExam,
            targetYear: intent.targetAcademicYear,
            currentClass: intent.currentClass,
          },
        });

        if (existingMembership) {
          await tx.groupCohortMember.update({
            where: { id: existingMembership.id },
            data: {
              stage: targetStage,
              phoneVerified: intentState.hasPhoneVerification,
              profileConfirmed: intentState.hasCourseConfirmation,
              explicitIntentAt: intentState.hasExplicitIntent ? now : null,
              isMinor: intent.isMinor,
              parentName: intent.isMinor ? intent.parentName?.trim() || null : null,
              parentPhone: normalizedParentPhone,
              parentNotifiedAt: null,
              parentConsentVerifiedAt: null,
              parentConsentMethod: null,
              joinedAt: now,
            },
          });
        } else {
          await tx.groupCohortMember.create({
            data: {
              cohortId,
              userId,
              stage: targetStage,
              phoneVerified: intentState.hasPhoneVerification,
              profileConfirmed: intentState.hasCourseConfirmation,
              explicitIntentAt: intentState.hasExplicitIntent ? now : null,
              isMinor: intent.isMinor,
              parentName: intent.isMinor ? intent.parentName?.trim() || null : null,
              parentPhone: normalizedParentPhone,
              parentNotifiedAt: null,
              parentConsentVerifiedAt: null,
              parentConsentMethod: null,
            },
          });
        }

        const newActiveCount = activeCount + 1;

        if (cohort.conversationId) {
          await tx.conversationParticipant.upsert({
            where: {
              conversationId_userId: {
                conversationId: cohort.conversationId,
                userId,
              },
            },
            create: {
              conversationId: cohort.conversationId,
              userId,
              role: cohort.createdById === userId ? "ADMIN" : "MEMBER",
              status: "ACTIVE",
            },
            update: {
              status: "ACTIVE",
              leftAt: null,
              role: cohort.createdById === userId ? "ADMIN" : "MEMBER",
            },
          });

          const joinMsg = await tx.message.create({
            data: {
              conversationId: cohort.conversationId,
              senderId: userId,
              type: "SYSTEM",
              content: `${publicMemberName} joined the BatchBuy cohort (${newActiveCount}/${cohort.targetSize} spots toward target).`,
            },
          });

          await tx.conversation.update({
            where: { id: cohort.conversationId },
            data: {
              memberCount: newActiveCount,
              lastMessageId: joinMsg.id,
              lastMessageAt: now,
              lastActivityAt: now,
            },
          });
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: cohort.institute.id,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "COHORT_JOINED",
          entityType: "GroupAdmissionCohort",
          entityId: cohort.id,
          afterState: {
            cohortCode: cohort.cohortCode,
            stage: targetStage,
            activeCount: newActiveCount,
          },
        });

        return {
          expired: false as const,
          cohortCode: cohort.cohortCode,
          cohortTitle: cohort.title,
          createdById: cohort.createdById,
          minRequired: cohort.minRequired,
          targetSize: cohort.targetSize,
          newActiveCount,
          instituteId: cohort.institute.id,
          instituteSlug: cohort.institute.slug,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (txOutcome.expired) {
      const properSlug = getInstituteProperSlug(txOutcome.instituteId, txOutcome.instituteSlug);
      revalidatePath("/batchbuy");
      revalidatePath(`/batchbuy/${txOutcome.cohortCode}`);
      revalidatePath(`/institute/${properSlug}`);
      return {
        success: false,
        error: "This cohort's forming window has expired.",
      };
    }

    if (txOutcome.createdById !== userId) {
      let notifTitle = `New member joined ${txOutcome.cohortCode}`;
      let notifBody = `${publicMemberName} joined "${txOutcome.cohortTitle}" (${txOutcome.newActiveCount}/${txOutcome.targetSize} students).`;

      if (txOutcome.newActiveCount === txOutcome.targetSize) {
        notifTitle = `Target Reached for ${txOutcome.cohortCode}!`;
        notifBody = `${txOutcome.newActiveCount} students have joined "${txOutcome.cohortTitle}". Your target group size is ready!`;
      } else if (txOutcome.newActiveCount === txOutcome.minRequired) {
        notifTitle = `Minimum Quorum Reached: ${txOutcome.cohortCode}`;
        notifBody = `"${txOutcome.cohortTitle}" reached its minimum quorum of ${txOutcome.minRequired} students.`;
      }

      await notifyUser(txOutcome.createdById, "SYSTEM", notifTitle, notifBody, cohortId);
    }

    const properSlug = getInstituteProperSlug(txOutcome.instituteId, txOutcome.instituteSlug);
    revalidatePath("/batchbuy");
    revalidatePath(`/batchbuy/${txOutcome.cohortCode}`);
    revalidatePath(`/institute/${properSlug}`);

    const updatedCohort = await getCohortDetailsByCode(txOutcome.cohortCode, userId);

    return {
      success: true,
      stage: targetStage,
      cohort: updatedCohort,
      message: user.phoneVerified
        ? "You are in! Your 3-level intent verification is complete."
        : "Joined cohort! Please verify your mobile number in Profile Settings to upgrade to Intent-Verified.",
    };
  } catch (err: unknown) {
    console.error("Failed to join BatchBuy cohort:", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return {
        success: false,
        error: "Another student joined at the exact same moment. Please try once more.",
      };
    }
    const msg = err instanceof Error ? err.message : "Could not join cohort.";
    return { success: false, error: msg };
  }
}

/**
 * Allows a student to gracefully leave a forming cohort.
 * Implements creator succession: promotes the earliest remaining member to creator/ADMIN,
 * or cancels the cohort if zero active members remain.
 */
export async function leaveBatchBuyCohort(cohortId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }

  const userId = session.user.id;
  const now = new Date();

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "group_admission_cohort" WHERE id = ${cohortId} FOR UPDATE`;

        const cohort = await tx.groupAdmissionCohort.findUnique({
          where: { id: cohortId },
          include: {
            institute: { select: { id: true, slug: true } },
            members: {
              orderBy: { joinedAt: "asc" },
              include: {
                user: { select: { name: true, username: true } },
              },
            },
          },
        });

        if (!cohort) {
          throw new Error("Cohort not found.");
        }

        if (cohort.status !== "FORMING" && cohort.status !== "DRAFT") {
          throw new Error(
            "Cannot leave via simple exit after an offer has been initiated for this cohort."
          );
        }

        const myMember = cohort.members.find(
          (m) => m.userId === userId && m.stage !== "DROPPED"
        );
        if (!myMember) {
          throw new Error("You are not an active member of this cohort.");
        }

        await tx.groupCohortMember.update({
          where: { id: myMember.id },
          data: { stage: "DROPPED" },
        });

        const remainingActive = cohort.members.filter(
          (m) => m.userId !== userId && m.stage !== "DROPPED"
        );

        let nextCreatorId: string | null = null;
        if (remainingActive.length === 0) {
          await tx.groupAdmissionCohort.update({
            where: { id: cohortId },
            data: { status: "CANCELLED" },
          });
        } else if (cohort.createdById === userId) {
          nextCreatorId = remainingActive[0].userId;
          await tx.groupAdmissionCohort.update({
            where: { id: cohortId },
            data: { createdById: nextCreatorId },
          });
        }

        if (cohort.conversationId) {
          await tx.conversationParticipant.updateMany({
            where: {
              conversationId: cohort.conversationId,
              userId,
            },
            data: {
              status: "ARCHIVED",
              leftAt: now,
              role: "MEMBER",
            },
          });

          if (nextCreatorId) {
            await tx.conversationParticipant.upsert({
              where: {
                conversationId_userId: {
                  conversationId: cohort.conversationId,
                  userId: nextCreatorId,
                },
              },
              create: {
                conversationId: cohort.conversationId,
                userId: nextCreatorId,
                role: "ADMIN",
                status: "ACTIVE",
              },
              update: {
                role: "ADMIN",
                status: "ACTIVE",
                leftAt: null,
              },
            });
          }

          const leaverName = formatPublicMemberName(myMember.user.name, myMember.user.username);
          const leaveMsg = await tx.message.create({
            data: {
              conversationId: cohort.conversationId,
              senderId: userId,
              type: "SYSTEM",
              content:
                remainingActive.length === 0
                  ? `${leaverName} left the cohort. Cohort cancelled as no members remain.`
                  : `${leaverName} left the cohort (${remainingActive.length}/${cohort.targetSize} spots filled).`,
            },
          });

          await tx.conversation.update({
            where: { id: cohort.conversationId },
            data: {
              memberCount: remainingActive.length,
              isReadOnly: remainingActive.length === 0,
              lastMessageId: leaveMsg.id,
              lastMessageAt: now,
              lastActivityAt: now,
            },
          });
        }

        await writeBatchBuyAuditLogTx(tx, {
          instituteId: cohort.institute.id,
          actorUserId: userId,
          actorRole: "STUDENT",
          action: "COHORT_LEFT",
          entityType: "GroupAdmissionCohort",
          entityId: cohort.id,
          afterState: {
            cohortCode: cohort.cohortCode,
            cohortCancelled: remainingActive.length === 0,
            remainingActiveCount: remainingActive.length,
          },
        });

        return {
          cohortCode: cohort.cohortCode,
          instituteId: cohort.institute.id,
          instituteSlug: cohort.institute.slug,
          cancelled: remainingActive.length === 0,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const properSlug = getInstituteProperSlug(outcome.instituteId, outcome.instituteSlug);
    revalidatePath("/batchbuy");
    revalidatePath(`/batchbuy/${outcome.cohortCode}`);
    revalidatePath(`/institute/${properSlug}`);

    return {
      success: true,
      cancelled: outcome.cancelled,
      message: outcome.cancelled
        ? "You left the cohort and it was archived since no active members remained."
        : "You have left this BatchBuy cohort.",
    };
  } catch (err: unknown) {
    console.error("Failed to leave cohort:", err);
    const msg = err instanceof Error ? err.message : "Could not leave cohort.";
    return { success: false, error: msg };
  }
}

/**
 * Syncs Level 1 phone verification from the user's verified account into their cohort membership,
 * upgrading stage from INTERESTED to INTENT_VERIFIED once OTP verification is completed.
 */
export async function syncMyCohortPhoneVerification(cohortId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phoneVerified: true },
  });

  if (!user?.phoneVerified) {
    return {
      success: false,
      error: "Your account mobile number is not verified yet. Verify via Profile Settings first.",
    };
  }

  const member = await prisma.groupCohortMember.findUnique({
    where: {
      cohortId_userId: {
        cohortId,
        userId: session.user.id,
      },
    },
    include: {
      cohort: { select: { cohortCode: true } },
    },
  });

  if (!member || member.stage === "DROPPED") {
    return { success: false, error: "Active cohort membership not found." };
  }

  const intentState = resolveMemberIntentState({
    phoneVerified: true,
    profileConfirmed: member.profileConfirmed,
    explicitIntentAt: member.explicitIntentAt,
  });

  const nextStage: CohortMemberStage =
    member.stage === "INTERESTED" ? intentState.stage : member.stage;

  await prisma.groupCohortMember.update({
    where: { id: member.id },
    data: {
      phoneVerified: true,
      stage: nextStage,
    },
  });

  revalidatePath(`/batchbuy/${member.cohort.cohortCode}`);
  return {
    success: true,
    stage: nextStage,
    message: "Mobile verification synced! You are now Intent-Verified.",
  };
}
