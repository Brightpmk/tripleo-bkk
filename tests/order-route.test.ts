import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/orders/route";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  submitOrderWithSlip: vi.fn()
}));

vi.mock("@/lib/server/order-service", () => ({
  submitOrderWithSlip: mocks.submitOrderWithSlip
}));

describe("order API route hardening", () => {
  it("rejects cross-site browser submissions before parsing uploads", async () => {
    const response = await POST(
      new Request("https://shop.example/api/orders", {
        method: "POST",
        headers: {
          origin: "https://evil.example"
        },
        body: new FormData()
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.submitOrderWithSlip).not.toHaveBeenCalled();
  });

  it("rejects oversized multipart requests before order persistence", async () => {
    const response = await POST(
      new Request("https://shop.example/api/orders", {
        method: "POST",
        headers: {
          origin: "https://shop.example",
          "content-length": String(6 * 1024 * 1024)
        },
        body: new FormData()
      })
    );

    expect(response.status).toBe(413);
    expect(mocks.submitOrderWithSlip).not.toHaveBeenCalled();
  });

  it("delegates same-origin valid multipart submissions", async () => {
    mocks.submitOrderWithSlip.mockResolvedValueOnce({
      ok: false,
      message: "stubbed validation"
    });
    const formData = new FormData();
    formData.set(
      "order",
      JSON.stringify({
        universityId: "bangmod",
        checkout: {
          fullName: "Ada",
          phone: "0812345678",
          deliveryMethod: "pickup",
          shippingAddress: ""
        },
        items: [],
        slipSelected: true,
        submissionKey: "route-test"
      })
    );
    formData.set(
      "slip",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "slip.jpg", {
        type: "image/jpeg"
      })
    );

    const response = await POST(
      new Request("https://shop.example/api/orders", {
        method: "POST",
        headers: {
          origin: "https://shop.example"
        },
        body: formData
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.submitOrderWithSlip).toHaveBeenCalledTimes(1);
  });
});
