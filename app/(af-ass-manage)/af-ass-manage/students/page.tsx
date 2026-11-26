import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { AdminStudentDirectoryClient } from "./AdminStudentDirectoryClient";
import { POPULAR_STUDENT_TAGS } from "@/components/student/StudentTagInput";

export const metadata = {
  title: "Students & Interest Tags | Admin Center | AcademyFind",
  description: "Search, filter, and outreach students by their learning interest tags, coaching categories, and exams.",
};

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const limit = 30;
  const search = typeof params.search === "string" ? params.search.trim() : "";
  const tag = typeof params.tag === "string" ? params.tag.trim() : "";
  const category = typeof params.category === "string" ? params.category.trim() : "";
  const city = typeof params.city === "string" ? params.city.trim() : "";
  const exam = typeof params.exam === "string" ? params.exam.trim() : "";
  const activeCategoryOrTag = category || tag;

  // Build Prisma Where query for StudentProfile
  const where: Prisma.StudentProfileWhereInput = {};

  if (activeCategoryOrTag) {
    const lower = activeCategoryOrTag.toLowerCase();
    const matchedPresets = POPULAR_STUDENT_TAGS.filter((pt) =>
      pt.toLowerCase().includes(lower) || lower.includes(pt.toLowerCase())
    );
    const candidateTags = Array.from(new Set([activeCategoryOrTag, ...matchedPresets]));

    where.OR = [
      { tags: { hasSome: candidateTags } },
      {
        user: {
          preference: {
            preferredCategories: {
              some: {
                category: {
                  name: { in: candidateTags, mode: "insensitive" },
                },
              },
            },
          },
        },
      },
    ];
  }

  if (city) {
    where.city = { equals: city, mode: "insensitive" };
  }

  if (exam) {
    where.targetExam = { equals: exam, mode: "insensitive" };
  }

  if (search) {
    const searchConditions: Prisma.StudentProfileWhereInput[] = [
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { user: { phone: { contains: search, mode: "insensitive" } } },
      { headline: { contains: search, mode: "insensitive" } },
      { bio: { contains: search, mode: "insensitive" } },
    ];

    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  // Parallel data fetching for stats, categories, and listing
  const [totalStudents, taggedStudentsCount, students, allTaggedProfiles, categories] = await Promise.all([
    prisma.studentProfile.count(),
    prisma.studentProfile.count({
      where: {
        tags: { isEmpty: false },
      },
    }),
    prisma.studentProfile.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: { updatedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            image: true,
            username: true,
            createdAt: true,
            emailVerified: true,
          },
        },
      },
    }),
    // Sample tags to compute popular tags aggregation
    prisma.studentProfile.findMany({
      where: { tags: { isEmpty: false } },
      select: { tags: true, city: true, targetExam: true },
      take: 500,
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Aggregate top tags and unique filter lists
  const tagCounts: Record<string, number> = {};
  const citiesSet = new Set<string>();
  const examsSet = new Set<string>();

  for (const profile of allTaggedProfiles) {
    for (const t of profile.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    if (profile.city) citiesSet.add(profile.city);
    if (profile.targetExam) examsSet.add(profile.targetExam);
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const availableCities = Array.from(citiesSet).sort();
  const availableExams = Array.from(examsSet).sort();

  const totalPages = Math.ceil(
    (activeCategoryOrTag || city || exam || search
      ? await prisma.studentProfile.count({ where })
      : totalStudents) / limit
  );

  return (
    <AdminStudentDirectoryClient
      students={students}
      stats={{
        totalStudents,
        taggedStudentsCount,
        totalPages,
        currentPage: page,
      }}
      topTags={topTags}
      availableCities={availableCities}
      availableExams={availableExams}
      categories={categories}
      currentFilters={{
        search,
        tag,
        category,
        city,
        exam,
      }}
    />
  );
}
