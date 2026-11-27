import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/getSession";

import { DailyLoginTrigger } from "@/components/DailyLoginTrigger";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  // if (!session.user.onboardingCompleted) redirect("/onboarding");
  if (!session.user.isActive) redirect("/login");
  return (
    <>
      <DailyLoginTrigger />
      {children}
    </>
  );
}
