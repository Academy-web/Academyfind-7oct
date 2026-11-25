"use server";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveStudentTags(tags: string[]) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return { success: false, error: "Unauthorized. Please log in." };
    }

    const userId = session.user.id;
    const cleanedTags = Array.from(
      new Set(
        tags
          .map((t) => t.trim().replace(/^#+/, ""))
          .filter((t) => t.length > 0 && t.length <= 40)
      )
    ).slice(0, 20);

    // Upsert student profile with the new tags
    await prisma.studentProfile.upsert({
      where: { userId },
      update: {
        tags: cleanedTags,
      },
      create: {
        userId,
        tags: cleanedTags,
        isVisible: true,
      },
    });

    // Revalidate relevant pages
    revalidatePath("/settings/profile");
    revalidatePath("/community/buddies");
    if (session.user.name) {
      revalidatePath(`/u/${encodeURIComponent(session.user.name)}`);
    }

    return {
      success: true,
      tags: cleanedTags,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update tags.";
    console.error("Error in saveStudentTags:", error);
    return { success: false, error: message };
  }
}
