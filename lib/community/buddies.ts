"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/getSession";
import { requireAuth } from "@/lib/auth/requireAuth";
import { getOrCreateDm } from "@/lib/chat/createDm";

// Haversine distance calculator (in Kilometers)
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10; // Rounded to 1 decimal
}

// ─── 1. Get Nearby Study Buddies ───────────────────────────────────────

export interface GetNearbyBuddiesParams {
  examCategory?: string;
  city?: string;
  tag?: string;
  search?: string;
  radiusKm?: number;
  userLat?: number;
  userLng?: number;
  page?: number;
  limit?: number;
}

export async function getNearbyBuddies(params: GetNearbyBuddiesParams = {}) {
  const session = await getSession();
  const currentUserId = session?.user?.id;

  const {
    examCategory,
    city,
    tag,
    search,
    radiusKm,
    userLat,
    userLng,
    page = 1,
    limit = 18,
  } = params;

  const skip = (page - 1) * limit;

  const where: any = {
    isVisible: true,
    lookingForBuddy: true,
  };

  if (currentUserId) {
    where.userId = { not: currentUserId };
  }

  if (examCategory && examCategory !== "ALL") {
    where.targetExam = { contains: examCategory, mode: "insensitive" };
  }

  if (city && city !== "ALL") {
    where.city = { contains: city, mode: "insensitive" };
  }

  if (tag && tag !== "ALL") {
    where.tags = { has: tag };
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { headline: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { targetExam: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { locality: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { tags: { has: q } },
    ];
  }

  try {
    const [profiles, total] = await Promise.all([
      prisma.studentProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          userId: true,
          headline: true,
          bio: true,
          targetExam: true,
          targetYear: true,
          currentClass: true,
          city: true,
          locality: true,
          latitude: true,
          longitude: true,
          preferredMedium: true,
          subjects: true,
          tags: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
            },
          },
        },
      }),
      prisma.studentProfile.count({ where }),
    ]);

    // Fetch connection status if logged in
    let requestsMap = new Map<string, { id: string; status: string; isSender: boolean }>();
    if (currentUserId && profiles.length > 0) {
      const candidateUserIds = profiles.map((p: (typeof profiles)[number]) => p.userId);
      const requests = await prisma.buddyRequest.findMany({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: { in: candidateUserIds } },
            { senderId: { in: candidateUserIds }, receiverId: currentUserId },
          ],
        },
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          status: true,
        },
      });

      for (const r of requests as Array<{ id: string; senderId: string; receiverId: string; status: string }>) {
        const otherId = r.senderId === currentUserId ? r.receiverId : r.senderId;
        requestsMap.set(otherId, {
          id: r.id,
          status: r.status,
          isSender: r.senderId === currentUserId,
        });
      }
    }

    const formattedBuddies = profiles.map((p: (typeof profiles)[number]) => {
      let distanceKm: number | null = null;
      if (userLat && userLng && p.latitude && p.longitude) {
        distanceKm = calculateDistanceKm(userLat, userLng, p.latitude, p.longitude);
      }

      const reqInfo = requestsMap.get(p.userId);

      return {
        ...p,
        distanceKm,
        relationship: reqInfo
          ? {
              requestId: reqInfo.id,
              status: reqInfo.status,
              isSender: reqInfo.isSender,
            }
          : null,
      };
    });

    // Optional radius filter in-memory if coordinates exist
    let result = formattedBuddies;
    if (radiusKm && userLat && userLng) {
      result = result.filter((b: (typeof formattedBuddies)[number]) => b.distanceKm === null || b.distanceKm <= radiusKm);
    }

    return {
      success: true,
      buddies: result,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  } catch (error) {
    console.error("Error loading nearby buddies:", error);
    return {
      success: false,
      buddies: [],
      total: 0,
      page: 1,
      totalPages: 0,
      error: "Failed to load study buddies.",
    };
  }
}

// ─── 2. Send Study Buddy Request ───────────────────────────────────────

export async function sendBuddyRequest(receiverId: string, message?: string) {
  const session = await requireAuth();
  const senderId = session.user.id;

  if (senderId === receiverId) {
    return { success: false, error: "You cannot connect with yourself." };
  }

  try {
    const existing = await prisma.buddyRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });

    if (existing) {
      if (existing.status === "ACCEPTED") {
        return { success: true, status: "ACCEPTED", alreadyConnected: true };
      }
      if (existing.status === "PENDING") {
        return { success: true, status: "PENDING", alreadySent: true };
      }
      // Re-activate if declined/cancelled
      await prisma.buddyRequest.update({
        where: { id: existing.id },
        data: {
          senderId,
          receiverId,
          status: "PENDING",
          message: message || null,
        },
      });
      revalidatePath("/community/buddies");
      return { success: true, status: "PENDING" };
    }

    await prisma.buddyRequest.create({
      data: {
        senderId,
        receiverId,
        message: message || null,
        status: "PENDING",
      },
    });

    // Create notification for receiver
    await prisma.userNotification.create({
      data: {
        userId: receiverId,
        type: "SYSTEM",
        title: "New Study Buddy Request!",
        body: `${session.user.name || "A student"} wants to connect with you as a study buddy.`,
      },
    }).catch(() => null);

    revalidatePath("/community/buddies");
    return { success: true, status: "PENDING" };
  } catch (error: any) {
    console.error("Error sending buddy request:", error);
    return { success: false, error: "Failed to send buddy request." };
  }
}

// ─── 3. Respond to Buddy Request (ACCEPT / DECLINE) ────────────────────

export async function respondBuddyRequest(requestId: string, action: "ACCEPT" | "DECLINE") {
  const session = await requireAuth();
  const currentUserId = session.user.id;

  try {
    const request = await prisma.buddyRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        status: true,
      },
    });

    if (!request || request.receiverId !== currentUserId) {
      return { success: false, error: "Request not found or unauthorized." };
    }

    if (action === "DECLINE") {
      await prisma.buddyRequest.update({
        where: { id: requestId },
        data: { status: "DECLINED" },
      });
      revalidatePath("/community/buddies");
      return { success: true, status: "DECLINED" };
    }

    // ACCEPT:
    await prisma.buddyRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED" },
    });

    // Open/Create direct message conversation
    const conversation = await getOrCreateDm(request.senderId, request.receiverId);

    // Add study buddy greeting in DM
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: currentUserId,
        content: `🎉 You are now study buddies! Say hi and start preparing together.`,
        type: "SYSTEM",
      },
    }).catch(() => null);

    // Notify original sender
    await prisma.userNotification.create({
      data: {
        userId: request.senderId,
        type: "SYSTEM",
        title: "Buddy Request Accepted!",
        body: `${session.user.name || "A student"} accepted your study buddy request. You can now chat!`,
      },
    }).catch(() => null);

    revalidatePath("/community/buddies");
    revalidatePath(`/chat/${conversation.id}`);

    return {
      success: true,
      status: "ACCEPTED",
      conversationId: conversation.id,
    };
  } catch (error) {
    console.error("Error responding to buddy request:", error);
    return { success: false, error: "Failed to update buddy request." };
  }
}

// ─── 4. Update Student Buddy Preferences ──────────────────────────────

const updatePreferencesSchema = z.object({
  targetExam: z.string().trim().min(2).max(50),
  targetYear: z.number().int().min(2025).max(2035).optional(),
  city: z.string().trim().min(2).max(60),
  locality: z.string().trim().max(60).optional(),
  headline: z.string().trim().max(100).optional(),
  bio: z.string().trim().max(400).optional(),
  lookingForBuddy: z.boolean().default(true),
  preferredMedium: z.string().trim().max(30).optional(),
  subjects: z.array(z.string().trim()).max(6).optional(),
  tags: z.array(z.string().trim()).max(15).optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

export async function updateMyBuddyPreferences(data: UpdatePreferencesInput) {
  const session = await requireAuth();
  const userId = session.user.id;

  const parsed = updatePreferencesSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Invalid input." };
  }

  const {
    targetExam,
    targetYear,
    city,
    locality,
    headline,
    bio,
    lookingForBuddy,
    preferredMedium,
    subjects,
    tags,
  } = parsed.data;

  try {
    await prisma.studentProfile.upsert({
      where: { userId },
      create: {
        userId,
        targetExam: targetExam.toUpperCase(),
        targetYear: targetYear || null,
        city,
        locality: locality || null,
        headline: headline || null,
        bio: bio || null,
        lookingForBuddy,
        preferredMedium: preferredMedium || "English",
        subjects: subjects || [],
        tags: tags || [],
        isVisible: true,
      },
      update: {
        targetExam: targetExam.toUpperCase(),
        targetYear: targetYear || null,
        city,
        locality: locality || null,
        headline: headline || null,
        bio: bio || null,
        lookingForBuddy,
        preferredMedium: preferredMedium || "English",
        subjects: subjects || [],
        ...(tags !== undefined ? { tags } : {}),
      },
    });

    revalidatePath("/community");
    revalidatePath("/community/buddies");
    return { success: true };
  } catch (error: any) {
    console.error("Error updating buddy preferences:", error);
    return { success: false, error: "Failed to update study preferences." };
  }
}
