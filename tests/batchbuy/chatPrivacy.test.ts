jest.mock("../../lib/auth/getSession", () => ({
  getSession: jest.fn(),
}));

jest.mock("../../lib/auth/getMobileUserId", () => ({
  getMobileUserId: jest.fn(),
}));

jest.mock("../../lib/chat/notifyChatParticipants", () => ({
  notifyChatParticipants: jest.fn(async () => null),
}));

jest.mock("../../lib/prisma", () => ({
  prisma: {
    conversation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    conversationParticipant: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    instituteManager: {
      findFirst: jest.fn(),
    },
    userNotification: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { GET as getConversation } from "../../app/api/v2/conversations/[id]/route";
import { GET as getMessages } from "../../app/api/v2/conversations/[id]/messages/route";
import { GET as getParticipants } from "../../app/api/v2/conversations/[id]/participants/route";
import { POST as mobileJoinGroup } from "../../app/api/mobile/community/groups/[id]/join/route";
import { getSession } from "../../lib/auth/getSession";
import { getMobileUserId } from "../../lib/auth/getMobileUserId";
import { prisma } from "../../lib/prisma";

describe("BatchBuy Chat Privacy & Boundary Protection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("Blocks non-member and institute manager from accessing a BatchBuy GROUP conversation", async () => {
    (getSession as jest.Mock).mockResolvedValue({
      user: { id: "inst_mgr_1", role: "USER" },
    });
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: "conv_bb_1",
      type: "GROUP",
      title: "Cohort Chat",
      imageUrl: null,
      channelType: null,
      isReadOnly: false,
      _count: { participants: 1 },
      instituteId: "inst_allen",
      batchId: "batch_1",
      admissionCohort: { id: "cohort_1" },
      institute: { id: "inst_allen", name: "Allen", logo: null, slug: "allen", phone: "0744" },
      participants: [
        {
          role: "ADMIN",
          user: { id: "student_1", name: "Aarav", username: "aarav", image: null },
        },
      ],
    });
    (prisma.instituteManager.findFirst as jest.Mock).mockResolvedValue({
      id: "mgr_rec",
      userId: "inst_mgr_1",
      instituteId: "inst_allen",
    });

    const res = await getConversation(new Request("http://localhost/api/v2/conversations/conv_bb_1"), {
      params: Promise.resolve({ id: "conv_bb_1" }),
    });
    expect(res.status).toBe(404);
    expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled();

    // Messages route also rejects institute manager for GROUP cohort chats
    (prisma.conversationParticipant.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const msgRes = await getMessages(
      new Request("http://localhost/api/v2/conversations/conv_bb_1/messages"),
      { params: Promise.resolve({ id: "conv_bb_1" }) }
    );
    expect(msgRes.status).toBe(404);

    // Participants route also rejects institute manager for GROUP cohort chats
    (prisma.conversationParticipant.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const partRes = await getParticipants(
      new Request("http://localhost/api/v2/conversations/conv_bb_1/participants"),
      { params: Promise.resolve({ id: "conv_bb_1" }) }
    );
    expect(partRes.status).toBe(404);
  });

  test("Omits student phone numbers from GROUP conversation metadata payload even for active members", async () => {
    (getSession as jest.Mock).mockResolvedValue({
      user: { id: "student_1", role: "USER" },
    });
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: "conv_bb_1",
      type: "GROUP",
      title: "Cohort Chat",
      imageUrl: null,
      channelType: null,
      isReadOnly: false,
      _count: { participants: 1 },
      instituteId: "inst_allen",
      batchId: "batch_1",
      admissionCohort: { id: "cohort_1" },
      institute: { id: "inst_allen", name: "Allen", logo: null, slug: "allen", phone: "0744" },
      participants: [
        {
          role: "ADMIN",
          user: { id: "student_1", name: "Aarav", username: "aarav", image: null },
        },
      ],
    });
    (prisma.instituteManager.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await getConversation(new Request("http://localhost/api/v2/conversations/conv_bb_1"), {
      params: Promise.resolve({ id: "conv_bb_1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversation.participants[0].user).not.toHaveProperty("phone");
  });

  test("Blocks mobile community study-group join endpoint from joining private/BatchBuy cohorts", async () => {
    (getMobileUserId as jest.Mock).mockResolvedValue("outsider_1");
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      id: "conv_bb_1",
      isStudyGroup: false,
      visibility: "PRIVATE",
      admissionCohort: { id: "cohort_1" },
      participants: [],
    });

    const res = await mobileJoinGroup({} as any, {
      params: Promise.resolve({ id: "conv_bb_1" }),
    });
    expect(res.status).toBe(404);
  });
});
