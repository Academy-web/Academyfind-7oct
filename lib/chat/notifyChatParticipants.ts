import { prisma } from "@/lib/prisma";
import { sendExpoPushNotification } from "@/lib/pushNotifications";
import { sendEmail } from "@/lib/notifications/email";
import {
  buildNewMessageEmailHtml,
  NEW_MESSAGE_EMAIL_SUBJECT,
} from "@/lib/notifications/messageEmail";

interface NotifyChatParams {
  conversationId: string;
  senderId: string;
  messageContent: string;
  messageType?: string;
}

interface ChatParticipantItem {
  userId: string;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    pushToken: string | null;
  } | null;
}

/**
 * Sends both in-app and mobile push notifications to all active participants in a conversation.
 */
export async function notifyChatParticipants({
  conversationId,
  senderId,
  messageContent,
  messageType = "TEXT",
}: NotifyChatParams) {
  try {
    // 1. Fetch sender info & conversation details
    const [sender, conversation] = await Promise.all([
      prisma.user.findUnique({
        where: { id: senderId },
        select: { id: true, name: true, image: true, username: true },
      }),
      prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          type: true,
          title: true,
          channelType: true,
          institute: { select: { id: true, name: true } },
          batch: { select: { id: true, name: true } },
        },
      }),
    ]);

    if (!conversation || !sender) return;

    const senderName = sender.name || sender.username || "Someone";

    // 2. Fetch all active participants except sender who haven't muted notifications
    const participants: ChatParticipantItem[] = await prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        userId: { not: senderId },
        status: "ACTIVE",
        isMuted: false,
        notificationsMuted: false,
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            pushToken: true,
          },
        },
      },
    });

    if (participants.length === 0) return;

    // 3. Construct Notification Title & Body
    let title = senderName;
    if (conversation.type === "DIRECT") {
      title = senderName;
    } else if (conversation.title) {
      title = `${senderName} in ${conversation.title}`;
    } else if (conversation.batch?.name) {
      title = `${senderName} (${conversation.batch.name})`;
    } else if (conversation.institute?.name) {
      title = `${senderName} (${conversation.institute.name})`;
    }

    let body = messageContent;
    if (messageType === "IMAGE") {
      body = "📷 Sent a photo";
    } else if (messageType === "FILE") {
      body = "📎 Sent an attachment";
    } else if (messageType === "AUDIO") {
      body = "🎤 Sent an audio message";
    } else if (messageType === "VIDEO") {
      body = "🎥 Sent a video";
    }

    if (body.length > 120) {
      body = body.slice(0, 117) + "...";
    }

    // 4. Create in-app UserNotification entries
    try {
      await prisma.userNotification.createMany({
        data: participants.map((p: ChatParticipantItem) => ({
          userId: p.userId,
          type: "MESSAGE",
          title,
          body,
          entityId: conversationId,
        })),
      });
    } catch (dbErr) {
      console.error("Failed to create in-app chat notifications:", dbErr);
    }

    // 5. Send Live Expo Push Notifications to mobile devices
    for (const p of participants) {
      if (p.user?.pushToken) {
        // Query unread count for this participant so their app icon badge displays accurately
        const unreadCount = await prisma.userNotification.count({
          where: { userId: p.userId, isRead: false },
        }).catch(() => undefined);

        sendExpoPushNotification({
          pushToken: p.user.pushToken,
          title,
          body,
          channelId: "chat",
          badge: unreadCount,
          data: {
            conversationId,
            screen: `/chat/${conversationId}`,
            type: "CHAT_MESSAGE",
            senderId,
          },
        }).catch((pushErr) => console.error("Chat push notification error:", pushErr));
      }
    }

    // 6. Send Auto Email Notifications to participants with an email address
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://academyfind.com").replace(/\/+$/, "");
    const chatUrl = `${baseUrl}/chat/${conversationId}`;
    const conversationLabel =
      conversation.type === "DIRECT"
        ? null
        : conversation.title ||
          conversation.batch?.name ||
          conversation.institute?.name ||
          null;

    await Promise.allSettled(
      participants
        .filter((p) => Boolean(p.user?.email))
        .map((p) => {
          const html = buildNewMessageEmailHtml({
            recipientName: p.user?.name,
            senderName,
            conversationLabel,
            messagePreview: body,
            chatUrl,
          });
          return sendEmail(p.user!.email!, NEW_MESSAGE_EMAIL_SUBJECT, html).catch(
            (emailErr) => console.error("Chat email notification error:", emailErr)
          );
        })
    );
  } catch (error) {
    console.error("notifyChatParticipants unexpected error:", error);
  }
}
