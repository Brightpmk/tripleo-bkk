import { describe, expect, it } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import { validateOrderSubmission } from "@/lib/server/order-validation";

const baseRequest: OrderSubmissionRequest = {
  universityId: "bangmod",
  checkout: {
    fullName: "Ada Lovelace",
    phone: "0812345678",
    deliveryMethod: "pickup",
    shippingAddress: ""
  },
  items: [
    {
      productId: "kg-bm-matcha",
      size: "M",
      quantity: 2
    }
  ],
  slipSelected: true,
  submissionKey: "test-submission"
};

describe("server order validation", () => {
  it("rejects an empty cart", () => {
    const result = validateOrderSubmission({ ...baseRequest, items: [] });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.items).toBeDefined();
  });

  it("rejects an invalid product ID", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      items: [{ productId: "missing", size: "M", quantity: 1 }]
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.productId"]).toBeDefined();
  });

  it("rejects an unsupported size", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      items: [{ productId: "kg-bm-matcha", size: "4XL", quantity: 1 }]
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.size"]).toBeDefined();
  });

  it("rejects an invalid university", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      universityId: "invalid" as OrderSubmissionRequest["universityId"]
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.universityId).toBeDefined();
  });

  it("rejects shipping without an address", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      checkout: {
        ...baseRequest.checkout,
        deliveryMethod: "shipping",
        shippingAddress: ""
      }
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.shippingAddress).toBeDefined();
  });

  it("ignores manipulated client prices and uses canonical pricing", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      items: [
        {
          productId: "kg-bm-matcha",
          size: "M",
          quantity: 2,
          unitPriceThb: 1
        } as OrderSubmissionRequest["items"][number]
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.order.itemSubtotalThb : undefined).toBe(780);
    expect(result.ok ? result.order.finalTotalThb : undefined).toBe(780);
  });

  it("rejects products outside the selected university unless allowed", () => {
    const result = validateOrderSubmission({
      ...baseRequest,
      universityId: "north-bangkok",
      items: [{ productId: "kg-bm-matcha", size: "M", quantity: 1 }]
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.productId"]).toBeDefined();
  });
});
