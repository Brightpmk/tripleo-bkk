import { describe, expect, it } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import { validateOrderSubmission } from "@/lib/server/order-validation";
import { testProducts } from "./fixtures/products";

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
    const result = validateOrderSubmission({ ...baseRequest, items: [] }, testProducts);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.items).toBeDefined();
  });

  it("rejects an invalid product ID", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        items: [{ productId: "missing", size: "M", quantity: 1 }]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.productId"]).toBeDefined();
  });

  it("rejects an unsupported size", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        items: [{ productId: "kg-bm-matcha", size: "4XL", quantity: 1 }]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.size"]).toBeDefined();
  });

  it("rejects an invalid university", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        universityId: "invalid" as OrderSubmissionRequest["universityId"]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.universityId).toBeDefined();
  });

  it("rejects shipping without an address", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        checkout: {
          ...baseRequest.checkout,
          deliveryMethod: "shipping",
          shippingAddress: ""
        }
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors.shippingAddress).toBeDefined();
  });

  it("ignores manipulated client prices and uses canonical pricing", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        items: [
          {
            productId: "kg-bm-matcha",
            size: "M",
            quantity: 2
          }
        ]
      },
      testProducts
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.order.itemSubtotalThb : undefined).toBe(780);
    expect(result.ok ? result.order.finalTotalThb : undefined).toBe(780);
  });

  it("rejects products outside the selected university unless allowed", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        universityId: "north-bangkok",
        items: [{ productId: "kg-bm-matcha", size: "M", quantity: 1 }]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.productId"]).toBeDefined();
  });

  it("rejects stale displayed prices before finalizing", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        items: [
          {
            productId: "kg-bm-matcha",
            size: "M",
            quantity: 2,
            displayedUnitPriceThb: 1
          }
        ]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.message).toContain("review your cart");
    expect(result.ok ? undefined : result.fieldErrors["items.0.price"]).toBeDefined();
  });

  it("rejects inactive products even when submitted manually", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        items: [{ productId: "kg-bm-aurora", size: "S", quantity: 1 }]
      },
      testProducts
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.productId"]).toBeDefined();
  });
});
