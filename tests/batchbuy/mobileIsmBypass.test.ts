import { NextRequest } from "next/server";
import { POST } from "../../app/api/mobile/ism/[instituteId]/leads/[leadId]/route";
import { prisma } from "../../lib/prisma";
import { getSession } from "../../lib/auth/getSession";
import {
  createAdmissionFromPipelineTx,
  detectAndFlagPotentialBypassTx,
} from "../../lib/instituteSalesManager/admissionPipeline";

jest.mock("../../lib/auth/getSession", () => ({
  getSession: jest.fn(),
}));

jest.mock("../../lib/notifications/notify", () => ({
  notifyUser: jest.fn(async () => null),
}));

jest.mock("../../lib/instituteSalesManager/admissionPipeline", () => ({
  createAdmissionFromPipelineTx: jest.fn(async () => ({
    id: "adm_mobile_1",
    enquiryId: "lead_1",
    instituteId: "inst_1",
    studentName: "Aarav Verma",
    totalFee: 95000,
    paidAmount: 0,
    status: "CONFIRMED",
  })),
  detectAndFlagPotentialBypassTx: jest.fn(async () => ({
    flagged: true,
    attributionId: "attr_mobile_1",
  })),
}));

const mockTx = { __tx: true };

jest.mock("../../lib/prisma", () => ({
  prisma: {
    instituteEnquiry: { findUnique: jest.fn() },
    instituteManager: { findUnique: jest.fn(), findMany: jest.fn(async () => []) },
    admissionRecord: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  },
}));

describe("Mobile ISM API Route: CONVERT_ADMISSION Anti-Bypass Parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST CONVERT_ADMISSION runs createAdmissionFromPipelineTx + detectAndFlagPotentialBypassTx inside single transaction", async () => {
    (getSession as jest.Mock).mockResolvedValueOnce({
      user: {
        id: "ism_1",
        name: "Priya ISM",
        role: "INSTITUTE_SALES_MANAGER",
      },
    });
    (prisma.instituteEnquiry.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "lead_1",
      instituteId: "inst_1",
      assignedIsmId: "ism_1",
      name: "Aarav Verma",
      phone: "9876543210",
      email: "aarav@example.com",
      course: "JEE Advanced",
      status: "CONTACTED",
    });
    (prisma.instituteManager.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.admissionRecord.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost/api/mobile/ism/inst_1/leads/lead_1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CONVERT_ADMISSION",
        courseName: "JEE Advanced",
        totalFee: 95000,
        admissionNote: "Converted via mobile ISM",
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ instituteId: "inst_1", leadId: "lead_1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(createAdmissionFromPipelineTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        enquiryId: "lead_1",
        instituteId: "inst_1",
        ismId: "ism_1",
        enquiryStatus: "CONVERTED",
        totalFee: 95000,
      })
    );
    expect(detectAndFlagPotentialBypassTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        admissionId: "adm_mobile_1",
        enquiryId: "lead_1",
        instituteId: "inst_1",
        leadName: "Aarav Verma",
        leadPhone: "9876543210",
        leadEmail: "aarav@example.com",
        actorUserId: "ism_1",
      })
    );
  });
});
