import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { StudentOutreachClient } from "./StudentOutreachClient";
import { POPULAR_STUDENT_TAGS } from "@/components/student/StudentTagInput";

type Props = {
  params: Promise<{ instituteId: string }>;
  searchParams: Promise<{
    tag?: string;
    city?: string;
    q?: string;
  }>;
};

export const metadata = {
  title: "Targeted Student Outreach & Broadcast | Manager Dashboard | AcademyFind",
  robots: { index: false, follow: false },
};

export default async function ManagerStudentOutreachPage({ params, searchParams }: Props) {
  const { instituteId } = await params;
  const sParams = await searchParams;
  const currentTag = sParams.tag || "ALL";
  const currentCity = sParams.city || "ALL";
  const currentSearch = sParams.q || "";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const institute = await prisma.institute.findUnique({
    where: { id: instituteId },
    select: {
      id: true,
      name: true,
      city: { select: { name: true } },
      categories: {
        select: {
          category: {
            select: { name: true },
          },
        },
      },
    },
  });

  if (!institute) notFound();

  // Combine category names and popular tags for easy filtering
  const categoryNames = institute.categories.map((c) => c.category.name);
  const combinedTagSet = new Set<string>([
    ...categoryNames,
    ...POPULAR_STUDENT_TAGS,
  ]);
  const availableTags = Array.from(combinedTagSet);

  // Build query filter
  const where: Prisma.StudentProfileWhereInput = {
    isVisible: true,
  };

  if (currentTag && currentTag !== "ALL") {
    where.tags = { has: currentTag };
  }

  if (currentCity && currentCity !== "ALL") {
    where.city = { contains: currentCity, mode: "insensitive" };
  }

  if (currentSearch && currentSearch.trim()) {
    const q = currentSearch.trim();
    where.OR = [
      { headline: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { targetExam: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { locality: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { username: { contains: q, mode: "insensitive" } } },
      { tags: { has: q } },
    ];
  }

  const [students, totalCount] = await Promise.all([
    prisma.studentProfile.findMany({
      where,
      take: 60,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        headline: true,
        bio: true,
        targetExam: true,
        currentClass: true,
        city: true,
        locality: true,
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

  return (
    <StudentOutreachClient
      instituteId={instituteId}
      instituteName={institute.name}
      instituteCity={institute.city?.name || ""}
      students={students}
      availableTags={availableTags}
      currentTag={currentTag}
      currentCity={currentCity}
      currentSearch={currentSearch}
      totalCount={totalCount}
    />
  );
}
