import { describe, expect, it } from "vitest";
import { addCartItem, getCartSubtotal } from "@/lib/cart";
import { calculateOrderTotals } from "@/lib/pricing";
import {
  getSizeSurchargeThb,
  getUnitPriceThbForSize,
  hasSizeSurcharge,
  SIZE_SURCHARGE_THB
} from "@/lib/size-pricing";
import { testProducts } from "./fixtures/products";

const oversizeProduct = testProducts.find(
  (product) => product.id === "kg-bm-oversize"
)!;

describe("size surcharge rule", () => {
  it.each(["XS", "S", "M", "L", "XL", "2XL"])(
    "charges no surcharge for %s",
    (size) => {
      expect(hasSizeSurcharge(size)).toBe(false);
      expect(getSizeSurchargeThb(size)).toBe(0);
    }
  );

  it.each(["3XL", "4XL", "5XL"])("charges +15 THB for %s", (size) => {
    expect(hasSizeSurcharge(size)).toBe(true);
    expect(getSizeSurchargeThb(size)).toBe(SIZE_SURCHARGE_THB);
  });

  it("applies the rule to any size above 3XL", () => {
    expect(getSizeSurchargeThb("6XL")).toBe(SIZE_SURCHARGE_THB);
    expect(getSizeSurchargeThb("10XL")).toBe(SIZE_SURCHARGE_THB);
  });

  it("normalizes casing and whitespace before matching", () => {
    expect(getSizeSurchargeThb(" 4xl ")).toBe(SIZE_SURCHARGE_THB);
    expect(getSizeSurchargeThb("3 XL")).toBe(SIZE_SURCHARGE_THB);
    expect(getSizeSurchargeThb(" 2xl ")).toBe(0);
  });

  it("adds the surcharge on top of the base price", () => {
    expect(getUnitPriceThbForSize(250, "2XL")).toBe(250);
    expect(getUnitPriceThbForSize(250, "3XL")).toBe(265);
    expect(getUnitPriceThbForSize(250, "4XL")).toBe(265);
    expect(getUnitPriceThbForSize(250, "5XL")).toBe(265);
  });
});

describe("cart pricing with size surcharge", () => {
  function addOversize(size: string, quantity: number) {
    return addCartItem([], {
      product: oversizeProduct,
      universityId: "bangmod",
      size,
      quantity
    });
  }

  it("stores the base price, the surcharge, and the adjusted unit price", () => {
    const [line] = addOversize("3XL", 1);

    expect(line.basePriceThb).toBe(250);
    expect(line.sizeSurchargeThb).toBe(15);
    expect(line.unitPriceThb).toBe(265);
  });

  it("charges no surcharge on 2XL", () => {
    const cart = addOversize("2XL", 1);

    expect(cart[0].unitPriceThb).toBe(250);
    expect(getCartSubtotal(cart)).toBe(250);
  });

  it("multiplies quantity by the adjusted unit price", () => {
    // 4XL x 2 -> (250 + 15) * 2
    expect(getCartSubtotal(addOversize("4XL", 2))).toBe(530);
    expect(getCartSubtotal(addOversize("5XL", 3))).toBe(795);
  });

  it("keeps each size on its own line with its own price", () => {
    let cart = addOversize("M", 1);
    cart = addCartItem(cart, {
      product: oversizeProduct,
      universityId: "bangmod",
      size: "4XL",
      quantity: 2
    });

    expect(cart).toHaveLength(2);
    expect(cart[0].unitPriceThb).toBe(250);
    expect(cart[1].unitPriceThb).toBe(265);
    // 250 + (265 * 2)
    expect(getCartSubtotal(cart)).toBe(780);
  });

  it("totals a mixed cart of normal and oversized shirts with shipping", () => {
    let cart = addCartItem([], {
      product: testProducts[0],
      universityId: "bangmod",
      size: "M",
      quantity: 2
    });
    cart = addCartItem(cart, {
      product: oversizeProduct,
      universityId: "bangmod",
      size: "5XL",
      quantity: 2
    });

    // (390 * 2) + (265 * 2) = 780 + 530 = 1310
    expect(calculateOrderTotals(cart, "pickup")).toEqual({
      itemSubtotalThb: 1310,
      shippingFeeThb: 0,
      finalTotalThb: 1310
    });

    expect(calculateOrderTotals(cart, "shipping")).toEqual({
      itemSubtotalThb: 1310,
      shippingFeeThb: 50,
      finalTotalThb: 1360
    });
  });
});
