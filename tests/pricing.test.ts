import { describe, expect, it } from "vitest";
import { addCartItem, updateCartQuantity } from "@/lib/cart";
import { calculateOrderTotals, getShippingFee } from "@/lib/pricing";
import { testProducts } from "./fixtures/products";

const product = testProducts[0];

describe("pricing rules", () => {
  it("charges 0 THB shipping for pickup", () => {
    expect(getShippingFee("pickup")).toBe(0);
    expect(getShippingFee("pickup", 12)).toBe(0);
  });

  it("charges 50 THB shipping for 1 to 10 shirts", () => {
    expect(getShippingFee("shipping")).toBe(50);
    expect(getShippingFee("shipping", 1)).toBe(50);
    expect(getShippingFee("shipping", 5)).toBe(50);
    expect(getShippingFee("shipping", 10)).toBe(50);
  });

  it("charges +10 THB per extra shirt over 10 (e.g. 12 shirts = 70 THB)", () => {
    expect(getShippingFee("shipping", 11)).toBe(60);
    expect(getShippingFee("shipping", 12)).toBe(70);
    expect(getShippingFee("shipping", 15)).toBe(100);
    expect(getShippingFee("shipping", 20)).toBe(150);
  });

  it("calculates final totals from cart and delivery method for 2 shirts", () => {
    const cart = addCartItem([], {
      product,
      universityId: "bangmod",
      size: "M",
      quantity: 2
    });

    expect(calculateOrderTotals(cart, "shipping")).toEqual({
      itemSubtotalThb: product.priceThb * 2,
      shippingFeeThb: 50,
      finalTotalThb: product.priceThb * 2 + 50
    });
  });

  it("calculates final totals with progressive shipping fee for 12 shirts", () => {
    const cart = addCartItem([], {
      product,
      universityId: "bangmod",
      size: "M",
      quantity: 12
    });

    expect(calculateOrderTotals(cart, "shipping")).toEqual({
      itemSubtotalThb: product.priceThb * 12,
      shippingFeeThb: 70,
      finalTotalThb: product.priceThb * 12 + 70
    });
  });
});

describe("cart quantity behavior", () => {
  it("merges matching product, university, and size lines", () => {
    const cart = addCartItem([], {
      product,
      universityId: "bangmod",
      size: "L",
      quantity: 1
    });

    const updatedCart = addCartItem(cart, {
      product,
      universityId: "bangmod",
      size: "L",
      quantity: 2
    });

    expect(updatedCart).toHaveLength(1);
    expect(updatedCart[0].quantity).toBe(3);
  });

  it("updates quantity and removes the line at zero", () => {
    const cart = addCartItem([], {
      product,
      universityId: "bangmod",
      size: "M",
      quantity: 2
    });

    const changedCart = updateCartQuantity(cart, cart[0].lineId, 4);
    expect(changedCart[0].quantity).toBe(4);

    const emptiedCart = updateCartQuantity(changedCart, cart[0].lineId, 0);
    expect(emptiedCart).toEqual([]);
  });
});
