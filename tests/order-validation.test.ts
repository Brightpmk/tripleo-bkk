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

describe("server-side size surcharge", () => {
  function submit(size: string, quantity: number, displayedUnitPriceThb?: number) {
    return validateOrderSubmission(
      {
        ...baseRequest,
        items: [
          {
            productId: "kg-bm-oversize",
            size,
            quantity,
            ...(displayedUnitPriceThb === undefined
              ? {}
              : { displayedUnitPriceThb })
          }
        ]
      },
      testProducts
    );
  }

  it.each([
    ["2XL", 1, 250],
    ["3XL", 1, 265],
    ["4XL", 1, 265],
    ["5XL", 1, 265],
    ["4XL", 2, 530],
    ["3XL", 3, 795]
  ])(
    "prices %s x%i at %i THB from the canonical base price",
    (size, quantity, expectedSubtotal) => {
      const result = submit(size, quantity);

      expect(result.ok).toBe(true);
      expect(result.ok ? result.order.itemSubtotalThb : undefined).toBe(
        expectedSubtotal
      );
      expect(result.ok ? result.order.finalTotalThb : undefined).toBe(
        expectedSubtotal
      );
    }
  );

  it("records the base price and surcharge on each order line", () => {
    const result = submit("4XL", 2);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.order.items[0] : undefined).toMatchObject({
      size: "4XL",
      quantity: 2,
      basePriceThb: 250,
      sizeSurchargeThb: 15,
      unitPriceThb: 265
    });
  });

  it("ignores a client that under-reports the surcharged price", () => {
    // A tampered client claims 3XL still costs the base 250 THB.
    const result = submit("3XL", 1, 250);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.fieldErrors["items.0.price"]).toBeDefined();
    expect(result.ok ? undefined : result.message).toContain("review your cart");
  });

  it("ignores a client that invents any other unit price", () => {
    expect(submit("4XL", 1, 1).ok).toBe(false);
    expect(submit("2XL", 1, 265).ok).toBe(false);
  });

  it("accepts a client price that matches the server calculation", () => {
    const result = submit("5XL", 2, 265);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.order.itemSubtotalThb : undefined).toBe(530);
  });

  it("adds the flat 50 THB shipping fee on top of surcharged items", () => {
    const result = validateOrderSubmission(
      {
        ...baseRequest,
        checkout: {
          ...baseRequest.checkout,
          deliveryMethod: "shipping",
          shippingAddress: "123 Test Road"
        },
        items: [
          { productId: "kg-bm-oversize", size: "4XL", quantity: 2 },
          { productId: "kg-bm-matcha", size: "M", quantity: 1 }
        ]
      },
      testProducts
    );

    expect(result.ok).toBe(true);
    // (265 * 2) + 390 = 920, plus 50 THB shipping
    expect(result.ok ? result.order.itemSubtotalThb : undefined).toBe(920);
    expect(result.ok ? result.order.shippingFeeThb : undefined).toBe(50);
    expect(result.ok ? result.order.finalTotalThb : undefined).toBe(970);
  });
});
