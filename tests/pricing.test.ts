import { describe, expect, it } from "vitest";
import { addCartItem, updateCartQuantity } from "@/lib/cart";
import { products } from "@/lib/catalog";
import { calculateOrderTotals, getShippingFee } from "@/lib/pricing";

const product = products[0];

describe("pricing rules", () => {
  it("charges 0 THB shipping for pickup", () => {
    expect(getShippingFee("pickup")).toBe(0);
  });

  it("charges 50 THB shipping for delivery", () => {
    expect(getShippingFee("shipping")).toBe(50);
  });

  it("calculates final totals from cart and delivery method", () => {
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
