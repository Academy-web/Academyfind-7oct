import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/getSession";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      title: true,
      imageUrl: true,
      channelType: true,
      isReadOnly: true,
      _count: {
        select: {
          participants: { where: { status: "ACTIVE" } }
        }
      },
      instituteId: true,
      batchId: true,
      admissionCohort: { select: { id: true } },
      institute: { select: { id: true, name: true, logo: true, slug: true, phone: true } },
      participants: {
        where: { status: "ACTIVE" },
        take: 50,
        select: {
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              image: true,
            },
          },
        },
      },
    },
  });

  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check if current user is participant
  let isParticipant = conversation.participants.some((p: any) => p.user?.id === userId);
  const isAdmin = session.user.role === "ADMIN";
  let isManager = false;

  if (conversation.instituteId) {
    const manager = await prisma.instituteManager.findFirst({
      where: { instituteId: conversation.instituteId, userId },
    });
    if (manager) isManager = true;
  }

  const isBatchBuyCohortChat =
    Boolean(conversation.admissionCohort) || conversation.type === "GROUP";

  // Private BatchBuy cohort chats and DIRECT chats require explicit active membership
  // (institute managers cannot snoop or auto-join student cohort discussions)
  if (!isParticipant) {
    const canAutoJoin =
      !isBatchBuyCohortChat &&
      (isAdmin || isManager || conversation.type === "INSTITUTE" || conversation.type === "BATCH");

    if (canAutoJoin) {
      try {
        await prisma.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId: id, userId } },
          create: { conversationId: id, userId, role: isManager || isAdmin ? "ADMIN" : "MEMBER", status: "ACTIVE" },
          update: { status: "ACTIVE", leftAt: null, isHidden: false },
        });
        isParticipant = true;
      } catch (e) {
        console.error("Auto participant add error:", e);
      }
    }
  }

  if (!isParticipant && !isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mark conversation as read for this participant
  prisma.conversationParticipant.updateMany({
    where: { conversationId: id, userId },
    data: { lastReadAt: new Date() },
  }).catch((err: any) => console.error("Error updating lastReadAt:", err));

  // Mark in-app user notifications for this conversation as read
  prisma.userNotification.updateMany({
    where: { userId, entityId: id, isRead: false },
    data: { isRead: true },
  }).catch((err: any) => console.error("Error updating notification isRead:", err));

  // Override memberCount with the actual active participant count
  const payload = {
    ...conversation,
    memberCount: conversation._count.participants,
    currentUserCanBypassReadOnly: isAdmin || isManager,
  };

  return NextResponse.json({ conversation: payload });
}
