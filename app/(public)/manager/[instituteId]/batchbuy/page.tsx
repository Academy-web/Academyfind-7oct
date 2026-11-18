import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ instituteId: string }>;
};

export default async function BatchBuyRootPage({ params }: Props) {
  const { instituteId } = await params;
  redirect(`/manager/${instituteId}/batchbuy/slabs`);
}
