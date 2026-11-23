"use server";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { notifyUserPush } from "@/lib/pushNotifications";
import { revalidatePath } from "next/cache";
import { z } from "zod";

async function verifyManagerAccess(instituteId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw new Error("Unauthorized. Please log in.");
  }

  if (session.user.role === "ADMIN") {
    return { session, authorized: true };
  }

  const manager = await prisma.instituteManager.findFirst({
    where: {
      instituteId,
      userId: session.user.id,
    },
  });

  if (!manager) {
    throw new Error("Forbidden: You do not have manager access to this institute.");
  }

  return { session, authorized: true };
}

// ─── Broadcast to Tagged Students ──────────────────────────────────────────

const broadcastSchema = z.object({
  instituteId: z.string().min(1),
  studentUserIds: z.array(z.string().min(1)).min(1, "Select at least one student"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(100),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(1000),
  actionUrl: z.string().trim().optional(),
});

export async function broadcastToStudents(input: z.infer<typeof broadcastSchema>) {
  try {
    const parsed = broadcastSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input." };
    }

    const { instituteId, studentUserIds, title, message, actionUrl } = parsed.data;
    await verifyManagerAccess(instituteId);

    const institute = await prisma.institute.findUnique({
      where: { id: instituteId },
      select: { id: true, name: true, slug: true },
    });

    if (!institute) {
      return { success: false, error: "Institute not found." };
    }

    const formattedTitle = `📢 ${institute.name}: ${title}`;
    const targetUrl = actionUrl || `/institute/${institute.slug}`;

    // Bulk create notifications in database
    await prisma.userNotification.createMany({
      data: studentUserIds.map((userId) => ({
        userId,
        type: "NOTICE",
        title: formattedTitle,
        body: message,
        entityId: institute.id,
        isRead: false,
      })),
    });

    // Fire off push notifications in background
    Promise.allSettled(
      studentUserIds.map((userId) =>
        notifyUserPush({
          userId,
          title: formattedTitle,
          body: message,
          data: {
            entityId: institute.id,
            actionUrl: targetUrl,
            type: "NOTICE",
          },
        })
      )
    ).catch((err) => console.error("Broadcast push error:", err));

    return {
      success: true,
      count: studentUserIds.length,
      message: `Broadcast successfully sent to ${studentUserIds.length} student${
        studentUserIds.length > 1 ? "s" : ""
      }!`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to broadcast message.";
    console.error("Error in broadcastToStudents:", error);
    return { success: false, error: message };
  }
}

// ─── Create Group with Tagged Students ─────────────────────────────────────

const createGroupSchema = z.object({
  instituteId: z.string().min(1),
  groupTitle: z.string().trim().min(3, "Group title must be at least 3 characters").max(80),
  description: z.string().trim().max(400).optional(),
  tag: z.string().trim().optional(),
  studentUserIds: z.array(z.string().min(1)).min(1, "Select at least one student"),
  initialMessage: z.string().trim().max(1000).optional(),
});

export async function createStudentGroupFromTags(input: z.infer<typeof createGroupSchema>) {
  try {
    const parsed = createGroupSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input." };
    }

    const { instituteId, groupTitle, description, tag, studentUserIds, initialMessage } =
      parsed.data;
    const { session } = await verifyManagerAccess(instituteId);

    const institute = await prisma.institute.findUnique({
      where: { id: instituteId },
      select: { id: true, name: true, slug: true, logo: true },
    });

    if (!institute) {
      return { success: false, error: "Institute not found." };
    }

    const uniqueStudentIds = Array.from(
      new Set(studentUserIds.filter((id) => id !== session.user.id))
    );

    const groupTags = tag ? [tag] : [];

    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        visibility: "PUBLIC",
        isStudyGroup: true,
        instituteId,
        title: groupTitle,
        description:
          description ||
          `Official targeted cohort by ${institute.name} for students interested in ${
            tag || "learning"
          }.`,
        imageUrl: institute.logo || null,
        tags: groupTags,
        createdById: session.user.id,
        memberCount: uniqueStudentIds.length + 1,
        participants: {
          create: [
            {
              userId: session.user.id,
              role: "OWNER",
              status: "ACTIVE",
            },
            ...uniqueStudentIds.map((userId) => ({
              userId,
              role: "MEMBER" as const,
              status: "ACTIVE" as const,
            })),
          ],
        },
        messages: {
          create: {
            senderId: session.user.id,
            content:
              initialMessage ||
              `Welcome to ${groupTitle}! This group is hosted by ${institute.name}. Ask your questions, connect with peers, and stay tuned for updates.`,
            type: "SYSTEM",
          },
        },
      },
      select: {
        id: true,
        title: true,
      },
    });

    // Notify added students
    await prisma.userNotification.createMany({
      data: uniqueStudentIds.map((userId) => ({
        userId,
        type: "SYSTEM",
        title: `👥 Added to ${groupTitle}`,
        body: `${institute.name} created a new study group for you. Click to open group chat!`,
        entityId: conversation.id,
        isRead: false,
      })),
    });

    revalidatePath(`/manager/${instituteId}`);
    revalidatePath("/chat");

    return {
      success: true,
      conversationId: conversation.id,
      count: uniqueStudentIds.length,
      message: `Group '${groupTitle}' created with ${uniqueStudentIds.length} student${
        uniqueStudentIds.length > 1 ? "s" : ""
      }!`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create group.";
    console.error("Error creating student group from tags:", error);
    return { success: false, error: message };
  }
}
