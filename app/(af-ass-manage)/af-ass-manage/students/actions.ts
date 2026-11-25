"use server";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { notifyUserPush } from "@/lib/pushNotifications";
import { revalidatePath } from "next/cache";
import { z } from "zod";

async function verifyAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Forbidden: Admin access required.");
  }

  return session;
}

const adminBroadcastSchema = z.object({
  studentUserIds: z.array(z.string().min(1)).min(1, "Select at least one student"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(100),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(1000),
  actionUrl: z.string().trim().optional(),
});

export async function adminBroadcastToStudents(input: z.infer<typeof adminBroadcastSchema>) {
  try {
    await verifyAdmin();
    const parsed = adminBroadcastSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input." };
    }

    const { studentUserIds, title, message, actionUrl } = parsed.data;
    const formattedTitle = `📢 AcademyFind Alert: ${title}`;
    const targetUrl = actionUrl || "/";

    // 1. Bulk create in-app notifications
    await prisma.userNotification.createMany({
      data: studentUserIds.map((userId) => ({
        userId,
        type: "NOTICE",
        title: formattedTitle,
        body: message,
        entityId: "admin-broadcast",
        isRead: false,
      })),
    });

    // 2. Fire web push notifications asynchronously
    Promise.allSettled(
      studentUserIds.map((userId) =>
        notifyUserPush({
          userId,
          title: formattedTitle,
          body: message,
          data: {
            actionUrl: targetUrl,
            type: "NOTICE",
          },
        })
      )
    ).catch((err) => console.error("Admin broadcast push error:", err));

    return {
      success: true,
      count: studentUserIds.length,
      message: `Broadcast sent to ${studentUserIds.length} student${
        studentUserIds.length > 1 ? "s" : ""
      }!`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to broadcast to students.";
    console.error("Error in adminBroadcastToStudents:", error);
    return { success: false, error: message };
  }
}

export async function adminUpdateStudentTags(studentProfileId: string, tags: string[]) {
  try {
    await verifyAdmin();
    const cleanedTags = tags.map((t) => t.trim().replace(/^#+/, "")).filter(Boolean);

    await prisma.studentProfile.update({
      where: { id: studentProfileId },
      data: { tags: cleanedTags },
    });

    revalidatePath("/af-ass-manage/students");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update tags.";
    return { success: false, error: message };
  }
}
