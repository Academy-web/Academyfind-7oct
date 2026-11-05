"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth/requireAuth";
import { prisma } from "@/lib/prisma";

export interface ManagedInstituteOption {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  imageUrl: string | null;
  cityName: string;
  isActive: boolean;
}

export async function getManagerManagedInstitutes(): Promise<ManagedInstituteOption[]> {
  const session = await requireAuth();

  const managerRecords = await prisma.instituteManager.findMany({
    where: { userId: session.user.id },
    include: {
      institute: {
        include: {
          city: {
            select: { name: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return managerRecords.map((m) => ({
    id: m.institute.id,
    name: m.institute.name,
    slug: m.institute.slug,
    logo: m.institute.logo,
    imageUrl: m.institute.imageUrl,
    cityName: m.institute.city?.name || "Unknown City",
    isActive: m.institute.isActive,
  }));
}

export async function createHub(payload: {
  name: string;
  description?: string;
  instituteIds: string[];
}): Promise<{ success: boolean; hubId?: string; error?: string }> {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const trimmedName = payload.name?.trim();
    if (!trimmedName || trimmedName.length < 2) {
      return { success: false, error: "Hub name must be at least 2 characters." };
    }
    if (trimmedName.length > 100) {
      return { success: false, error: "Hub name cannot exceed 100 characters." };
    }

    const uniqueInstituteIds = Array.from(new Set(payload.instituteIds || []));
    if (uniqueInstituteIds.length < 2) {
      return {
        success: false,
        error: "Please select at least 2 centers to create a network hub.",
      };
    }

    // STRICT MANAGER VERIFICATION:
    // Manager can ONLY add institutes that they are an authorized manager of!
    const managedRecords = await prisma.instituteManager.findMany({
      where: { userId },
      select: { instituteId: true },
    });
    const authorizedInstituteIds = new Set(managedRecords.map((r) => r.instituteId));

    if (session.user.role !== "ADMIN") {
      const unauthorized = uniqueInstituteIds.find((id) => !authorizedInstituteIds.has(id));
      if (unauthorized) {
        return {
          success: false,
          error: "Unauthorized: You can only link centers that you actively manage.",
        };
      }
    }

    const hub = await prisma.instituteHub.create({
      data: {
        name: trimmedName,
        description: payload.description?.trim() || null,
        createdById: userId,
        institutes: {
          create: uniqueInstituteIds.map((instId) => ({
            instituteId: instId,
          })),
        },
      },
      include: {
        institutes: true,
      },
    });

    revalidatePath("/manager");
    revalidatePath("/manager/hubs");
    uniqueInstituteIds.forEach((instId) => {
      revalidatePath(`/manager/${instId}`);
    });

    return { success: true, hubId: hub.id };
  } catch (error: any) {
    console.error("Error creating hub:", error);
    return {
      success: false,
      error: error?.message || "Failed to create hub. Please try again.",
    };
  }
}

export async function updateHub(payload: {
  hubId: string;
  name: string;
  description?: string;
  instituteIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const trimmedName = payload.name?.trim();
    if (!trimmedName || trimmedName.length < 2) {
      return { success: false, error: "Hub name must be at least 2 characters." };
    }

    const hub = await prisma.instituteHub.findUnique({
      where: { id: payload.hubId },
      include: { institutes: true },
    });

    if (!hub) {
      return { success: false, error: "Hub not found." };
    }

    // Ownership check
    if (hub.createdById !== userId && session.user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized: Only the manager who created this hub can edit it.",
      };
    }

    const uniqueInstituteIds = Array.from(new Set(payload.instituteIds || []));
    if (uniqueInstituteIds.length < 2) {
      return {
        success: false,
        error: "Please select at least 2 centers to keep this hub active.",
      };
    }

    // STRICT MANAGER VERIFICATION:
    const managedRecords = await prisma.instituteManager.findMany({
      where: { userId },
      select: { instituteId: true },
    });
    const authorizedInstituteIds = new Set(managedRecords.map((r) => r.instituteId));

    if (session.user.role !== "ADMIN") {
      const unauthorized = uniqueInstituteIds.find((id) => !authorizedInstituteIds.has(id));
      if (unauthorized) {
        return {
          success: false,
          error: "Unauthorized: You can only include centers that you actively manage.",
        };
      }
    }

    const oldInstituteIds = hub.institutes.map((i) => i.instituteId);

    await prisma.$transaction([
      prisma.instituteHub.update({
        where: { id: payload.hubId },
        data: {
          name: trimmedName,
          description: payload.description?.trim() || null,
        },
      }),
      prisma.instituteHubMember.deleteMany({
        where: { hubId: payload.hubId },
      }),
      prisma.instituteHubMember.createMany({
        data: uniqueInstituteIds.map((instId) => ({
          hubId: payload.hubId,
          instituteId: instId,
        })),
      }),
    ]);

    revalidatePath("/manager");
    revalidatePath("/manager/hubs");
    revalidatePath(`/manager/hubs/${payload.hubId}`);
    new Set([...oldInstituteIds, ...uniqueInstituteIds]).forEach((instId) => {
      revalidatePath(`/manager/${instId}`);
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error updating hub:", error);
    return {
      success: false,
      error: error?.message || "Failed to update hub.",
    };
  }
}

export async function deleteHub(
  hubId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const hub = await prisma.instituteHub.findUnique({
      where: { id: hubId },
      include: { institutes: true },
    });

    if (!hub) {
      return { success: false, error: "Hub not found." };
    }

    if (hub.createdById !== userId && session.user.role !== "ADMIN") {
      return {
        success: false,
        error: "Unauthorized: Only the manager who created this hub can delete it.",
      };
    }

    const instituteIds = hub.institutes.map((i) => i.instituteId);

    await prisma.instituteHub.delete({
      where: { id: hubId },
    });

    revalidatePath("/manager");
    revalidatePath("/manager/hubs");
    instituteIds.forEach((instId) => {
      revalidatePath(`/manager/${instId}`);
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error deleting hub:", error);
    return {
      success: false,
      error: error?.message || "Failed to delete hub.",
    };
  }
}
