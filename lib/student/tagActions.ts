"use server";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getPlatformCategoriesForTags() {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return categories;
  } catch (error) {
    console.error("Error fetching categories for tags:", error);
    return [];
  }
}

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
          .filter((t) => t.length > 0 && t.length <= 50)
      )
    ).slice(0, 20);

    // 1. Upsert student profile with the new tags
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

    // 2. Auto-sync matching platform categories into UserPreferredCategory
    if (cleanedTags.length > 0) {
      const matchedCategories = await prisma.category.findMany({
        where: {
          isActive: true,
          name: { in: cleanedTags, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (matchedCategories.length > 0) {
        const pref = await prisma.userPreference.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });

        // Ensure user preferred categories include these
        for (const cat of matchedCategories) {
          await prisma.userPreferredCategory.upsert({
            where: {
              preferenceId_categoryId: {
                preferenceId: pref.id,
                categoryId: cat.id,
              },
            },
            create: {
              preferenceId: pref.id,
              categoryId: cat.id,
            },
            update: {},
          });
        }
      }
    }

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
