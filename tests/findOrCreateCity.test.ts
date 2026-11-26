import { findOrCreateCity } from "@/lib/User/user/create-institute";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth/auth";
import { revalidatePath } from "next/cache";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    city: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload: jest.fn() },
  },
}));

jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn(),
}));

describe("findOrCreateCity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.api.getSession as jest.Mock).mockResolvedValue({
      user: { id: "user-1" },
    });
  });

  it("rejects unauthenticated callers", async () => {
    (auth.api.getSession as jest.Mock).mockResolvedValueOnce(null);

    const res = await findOrCreateCity({ name: "Kota", state: "Rajasthan" });

    expect(res).toEqual({
      success: false,
      error: "Please sign in to select a city.",
    });
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  it("returns existing city when matched by name and state", async () => {
    const existing = { id: "c1", name: "Kota", slug: "kota", state: "Rajasthan" };
    (prisma.city.findFirst as jest.Mock).mockResolvedValueOnce(existing);

    const res = await findOrCreateCity({ name: "Kota", state: "Rajasthan" });

    expect(res).toEqual({ success: true, city: existing, created: false });
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  it("creates a new city with proper slug, state, and coordinates when not found", async () => {
    (prisma.city.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.city.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const created = {
      id: "c2",
      name: "Greater Noida",
      slug: "greater-noida",
      state: "Uttar Pradesh",
    };
    (prisma.city.create as jest.Mock).mockResolvedValueOnce(created);

    const res = await findOrCreateCity({
      name: "Greater Noida",
      state: "Uttar Pradesh",
      latitude: 28.4744,
      longitude: 77.504,
    });

    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Greater Noida",
        slug: "greater-noida",
        state: "Uttar Pradesh",
        country: "India",
        latitude: 28.4744,
        longitude: 77.504,
      },
      select: { id: true, name: true, slug: true, state: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/user/create-institute");
    expect(revalidatePath).toHaveBeenCalledWith("/cities");
    expect(res).toEqual({ success: true, city: created, created: true });
  });

  it("appends state slug when base slug is already taken by another state", async () => {
    (prisma.city.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.city.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: "c-other",
        name: "Aurangabad",
        slug: "aurangabad",
        state: "Maharashtra",
      })
      .mockResolvedValueOnce(null);

    const created = {
      id: "c3",
      name: "Aurangabad",
      slug: "aurangabad-bihar",
      state: "Bihar",
    };
    (prisma.city.create as jest.Mock).mockResolvedValueOnce(created);

    const res = await findOrCreateCity({ name: "Aurangabad", state: "Bihar" });

    expect(prisma.city.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Aurangabad",
          slug: "aurangabad-bihar",
          state: "Bihar",
        }),
      })
    );
    expect(res).toEqual({ success: true, city: created, created: true });
  });
});
