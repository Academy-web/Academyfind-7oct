"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCachedSession } from "@/lib/auth/session";

const updateStudentProfileSchema = z.object({
  headline: z.string().trim().max(120).nullable(),

  bio: z.string().trim().max(1000).nullable(),

  currentClass: z.string().trim().max(50).nullable(),

  targetExam: z.string().trim().max(100).nullable(),

  tags: z.array(z.string().trim().min(1).max(40)).optional().default([]),
});

export async function updateStudentProfile(
  input: z.infer<typeof updateStudentProfileSchema>
) {
  const session = await getCachedSession();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const data = updateStudentProfileSchema.parse(input);

  const existing = await prisma.studentProfile.findUnique({
    where: {
      userId: session.user.id,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    await prisma.studentProfile.update({
      where: {
        userId: session.user.id,
      },
      data,
    });
  } else {
    await prisma.studentProfile.create({
      data: {
        ...data,
        userId: session.user.id,
      },
    });
  }

  return {
    success: true,
  };
}