import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  hasValidAdminSession: vi.fn(async () => true),
  getAdminOrderDetail: vi.fn(async () => ({ orderId: "KG-2026-AAAA1111" })),
  getAdminOrderSlipFileId: vi.fn(async () =>
    "blob:v1:payment-slips/KG-2026-AAAA1111/123e4567-e89b-42d3-a456-426614174000.png"
  ),
  read: vi.fn(async () => ({
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mimeType: "image/png"
  }))
}));

vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: mocks.hasValidAdminSession
}));

vi.mock("@/lib/server/order-admin-service", () => ({
  getAdminOrderDetail: mocks.getAdminOrderDetail,
  getAdminOrderSlipFileId: mocks.getAdminOrderSlipFileId
}));

vi.mock("@/lib/server/payment-slip-storage", () => ({
  PaymentSlipStorageRouter: class {
    read = mocks.read;
  }
}));

import { GET } from "@/app/api/admin/orders/[orderId]/slip/route";

describe("authenticated admin slip route", () => {
  it("streams the slip through the server without exposing its Blob reference", async () => {
    const response = await GET(
      new Request("https://shop.example/api/admin/orders/KG-2026-AAAA1111/slip"),
      { params: Promise.resolve({ orderId: "KG-2026-AAAA1111" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(mocks.read).toHaveBeenCalledWith(
      "blob:v1:payment-slips/KG-2026-AAAA1111/123e4567-e89b-42d3-a456-426614174000.png"
    );

    const visibleResponse = [...response.headers.entries()].join("\n");
    expect(visibleResponse).not.toContain("blob:v1:");
    expect(visibleResponse).not.toContain("blob.vercel-storage.com");
  });
});
