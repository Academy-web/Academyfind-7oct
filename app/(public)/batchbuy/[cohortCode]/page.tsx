import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { getCohortDetailsByCode } from "@/lib/batchbuy/cohortQueries";
import { getStudentCohortOfferWorkspace } from "@/lib/batchbuy/offerQueries";
import { CohortRoomClient } from "./CohortRoomClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ cohortCode: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cohortCode } = await params;
  const cohort = await getCohortDetailsByCode(cohortCode);

  if (!cohort) {
    return {
      title: "Cohort Not Found | BatchBuy | AcademyFind",
    };
  }

  const maxPct = cohort.slabProgress.maxDiscountPercentage;
  const discountSnippet =
    maxPct > 0 ? `Unlock up to ${maxPct}% OFF group fees` : "Form a collective admission group";

  const title = `${cohort.title} (${cohort.cohortCode}) | BatchBuy | AcademyFind`;
  const description = `${cohort.activeMemberCount}/${cohort.targetSize} students joined for ${cohort.institute.name} (${cohort.batch.name}). ${discountSnippet} with ₹0 advance on AcademyFind.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: cohort.institute.logo ? [cohort.institute.logo] : [],
    },
  };
}

export default async function CohortRoomPage({ params }: PageProps) {
  const { cohortCode } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const viewerUserId = session?.user?.id ?? null;

  const cohort = await getCohortDetailsByCode(cohortCode, viewerUserId);

  if (!cohort) {
    notFound();
  }

  const offerWorkspace = await getStudentCohortOfferWorkspace(
    cohort.id,
    cohort.cohortCode,
    viewerUserId
  );

  return (
    <main className="min-h-screen bg-linear-to-b from-amber-50/60 via-background to-background pb-16">
      <CohortRoomClient cohort={cohort} offerWorkspace={offerWorkspace} />
    </main>
  );
}
