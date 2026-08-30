import { describe, expect, it, vi } from "vitest";
import {
  getProductsForUniversity,
  productImagePlaceholder
} from "@/lib/catalog";

vi.mock("server-only", () => ({}));

const header = [
  "PRODUCT_ID",
  "UNIVERSITY",
  "SHIRT_COLOR",
  "PRICE",
  "IMAGE_URL",
  "AVAILABLE_SIZES",
  "ACTIVE",
  "SORT_ORDER"
];

describe("Products Sheet normalization", () => {
  it("parses a valid product with arbitrary data-driven ShirtColor", async () => {
    const { normalizeProductRows } = await import("@/lib/server/product-catalog");
    const products = normalizeProductRows([
      header,
      [
        "kg-bm-aurora",
        " bangmod ",
        "Aurora Glow",
        "450",
        "https://example.com/aurora.png",
        " XS, S, M, ",
        "TRUE",
        "2"
      ]
    ]);

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "kg-bm-aurora",
      primaryUniversityId: "bangmod",
      colorName: "Aurora Glow",
      name: "Aurora Glow Shirt",
      priceThb: 450,
      availableSizes: ["XS", "S", "M"],
      active: true,
      sortOrder: 2
    });
  });

  it("hides inactive products and rows with invalid prices, sizes, or universities", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { normalizeProductRows } = await import("@/lib/server/product-catalog");
    const products = normalizeProductRows([
      header,
      ["inactive", "BANGMOD", "Hidden", 390, "", "M", "false", 1],
      ["bad-price", "BANGMOD", "Free", "not money", "", "M", "TRUE", 2],
      ["bad-size", "BANGMOD", "No Size", 390, "", " , ", "TRUE", 3],
      ["bad-uni", "Somewhere", "Wrong", 390, "", "M", "TRUE", 4],
      ["good", "NORTH   BANGKOK", "Americano", "390 THB", "", "M,L", true, 5]
    ]);

    expect(products.map((product) => product.id)).toEqual(["good"]);
    expect(products[0].image).toBe(productImagePlaceholder);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("rejects duplicate PRODUCT_ID values instead of choosing one", async () => {
    const { normalizeProductRows, ProductCatalogError } = await import(
      "@/lib/server/product-catalog"
    );

    expect(() =>
      normalizeProductRows([
        header,
        ["duplicate", "BANGMOD", "Matcha", 390, "", "M", "TRUE", 1],
        ["duplicate", "LADKRABANG", "Berry", 420, "", "M", "TRUE", 2]
      ])
    ).toThrow(ProductCatalogError);
  });

  it("sorts by SORT_ORDER with deterministic fallback", async () => {
    const { normalizeProductRows } = await import("@/lib/server/product-catalog");
    const products = normalizeProductRows([
      header,
      ["third", "BANGMOD", "Zulu", 390, "", "M", "TRUE", ""],
      ["first", "BANGMOD", "Alpha", 390, "", "M", "TRUE", "1"],
      ["second", "BANGMOD", "Beta", 390, "", "M", "TRUE", "1"]
    ]);

    expect(products.map((product) => product.id)).toEqual([
      "first",
      "second",
      "third"
    ]);
  });

  it("filters active storefront products by university", async () => {
    const { normalizeProductRows } = await import("@/lib/server/product-catalog");
    const products = normalizeProductRows([
      header,
      ["bm-matcha", "BANGMOD", "Matcha", 390, "", "M", "TRUE", 2],
      ["lk-berry", "LADKRABANG", "Berry Blast", 420, "", "M", "TRUE", 1],
      ["bm-hidden", "BANGMOD", "Hidden", 390, "", "M", "FALSE", 3]
    ]);

    expect(getProductsForUniversity(products, "bangmod").map((product) => product.id)).toEqual([
      "bm-matcha"
    ]);
    expect(getProductsForUniversity(products, "ladkrabang").map((product) => product.colorName)).toEqual([
      "Berry Blast"
    ]);
  });
});
