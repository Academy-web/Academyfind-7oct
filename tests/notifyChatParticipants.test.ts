import { notifyChatParticipants } from "@/lib/chat/notifyChatParticipants";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/notifications/email";
import { NEW_MESSAGE_EMAIL_SUBJECT } from "@/lib/notifications/messageEmail";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    conversationParticipant: { findMany: jest.fn() },
    userNotification: { createMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock("@/lib/pushNotifications", () => ({
  sendExpoPushNotification: jest.fn(async () => undefined),
}));

jest.mock("@/lib/notifications/email", () => ({
  sendEmail: jest.fn(async () => ({ success: true })),
}));

describe("notifyChatParticipants auto email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "sender-1",
      name: "Rahul",
      image: null,
      username: "rahul",
    });
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: "conv-1",
      type: "DIRECT",
      title: null,
      channelType: null,
      institute: null,
      batch: null,
    });
    (prisma.userNotification.createMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it("sends auto email to active participants with email and escapes HTML", async () => {
    (prisma.conversationParticipant.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user-2",
        user: {
          id: "user-2",
          email: "student@example.com",
          name: "Priya",
          pushToken: null,
        },
      },
      {
        userId: "user-3",
        user: {
          id: "user-3",
          email: null,
          name: "NoEmailUser",
          pushToken: null,
        },
      },
    ]);

    await notifyChatParticipants({
      conversationId: "conv-1",
      senderId: "sender-1",
      messageContent: "Hello <script>alert(1)</script>!",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      "student@example.com",
      NEW_MESSAGE_EMAIL_SUBJECT,
      expect.stringContaining("You have received a new message on AcademyFind")
    );
    const htmlArg = (sendEmail as jest.Mock).mock.calls[0][2] as string;
    expect(htmlArg).toContain("Priya");
    expect(htmlArg).toContain("Rahul");
    expect(htmlArg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(htmlArg).not.toContain("<script>");
    expect(htmlArg).toContain("/chat/conv-1");
  });

  it("does not throw if sendEmail rejects", async () => {
    (prisma.conversationParticipant.findMany as jest.Mock).mockResolvedValue([
      {
        userId: "user-2",
        user: {
          id: "user-2",
          email: "student@example.com",
          name: "Priya",
          pushToken: null,
        },
      },
    ]);
    (sendEmail as jest.Mock).mockRejectedValueOnce(new Error("Resend down"));

    await expect(
      notifyChatParticipants({
        conversationId: "conv-1",
        senderId: "sender-1",
        messageContent: "Hi there",
      })
    ).resolves.toBeUndefined();
  });
});
