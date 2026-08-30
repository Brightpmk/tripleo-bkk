import { describe, expect, it, vi } from "vitest";
import {
  getProductsForUniversity,
  getUniversityById,
  universities,
  universityIds,
  universitySheetValues
} from "@/lib/catalog";
import { adminUniversities, getUniversityLabel } from "@/lib/admin-products";
import { normalizeProductRows } from "@/lib/server/product-catalog";
import { validateAdminProductInput } from "@/lib/server/product-admin";
import { mapOrderToSheetRows } from "@/lib/server/order-row-mapper";
import type { ConfirmedOrder } from "@/lib/orders";

vi.mock("server-only", () => ({}));

const productHeaderRow = [
  "PRODUCT_ID",
  "UNIVERSITY",
  "SHIRT_COLOR",
  "PRICE",
  "IMAGE_URL",
  "AVAILABLE_SIZES",
  "ACTIVE",
  "SORT_ORDER"
];

describe("supported universities", () => {
  it("supports exactly the eight Tripleo.bkk universities", () => {
    expect(universities).toHaveLength(8);
    expect(universityIds).toHaveLength(8);
    expect(universitySheetValues).toHaveLength(8);
  });

  it("keeps the canonical sheet values already stored in Google Sheets", () => {
    expect(universitySheetValues).toContain("BANGMOD");
    expect(universitySheetValues).toContain("LADKRABANG");
    expect(universitySheetValues).toContain("NORTH BANGKOK");
  });

  it("exposes a unique id, sheet value, and brand for every university", () => {
    expect(new Set(universities.map((u) => u.id)).size).toBe(8);
    expect(new Set(universities.map((u) => u.sheetValue)).size).toBe(8);
    expect(new Set(universities.map((u) => u.brand)).size).toBe(8);

    universities.forEach((university) => {
      expect(university.brand).toMatch(/^[a-z]+\.swagclub$/);
      expect(university.shortName.length).toBeGreaterThan(0);
      expect(university.fullName.length).toBeGreaterThan(0);
    });
  });

  it("resolves every id back to its university", () => {
    universityIds.forEach((id) => {
      expect(getUniversityById(id)?.id).toBe(id);
    });
  });
});

describe("all eight universities work end to end", () => {
  it("loads and filters a product for every university", () => {
    const rows = [
      productHeaderRow,
      ...universities.map((university, index) => [
        `p-${university.id}`,
        university.sheetValue,
        `Colour ${index}`,
        390,
        "",
        "M,3XL",
        "TRUE",
        index
      ])
    ];

    const products = normalizeProductRows(rows);
    expect(products).toHaveLength(8);

    universities.forEach((university) => {
      const forUniversity = getProductsForUniversity(products, university.id);
      expect(forUniversity.map((product) => product.id)).toEqual([
        `p-${university.id}`
      ]);
    });
  });

  it("accepts every university in admin product create/edit", () => {
    adminUniversities.forEach((sheetValue) => {
      const product = validateAdminProductInput({
        productId: "kg-test-product",
        university: sheetValue,
        shirtColor: "Matcha",
        priceThb: 390,
        imageUrl: "/products/product-placeholder.svg",
        availableSizes: ["M", "3XL"],
        active: true,
        sortOrder: 1
      });

      expect(product.university).toBe(sheetValue);
    });
  });

  it("persists the canonical sheet value on the order row", () => {
    universities.forEach((university) => {
      const order: ConfirmedOrder = {
        orderId: "KG-2026-TEST0001",
        createdAtIso: "2026-08-29T10:00:00.000Z",
        universityId: university.id,
        checkout: {
          fullName: "Ada Lovelace",
          phone: "0812345678",
          deliveryMethod: "pickup",
          shippingAddress: ""
        },
        items: [],
        itemSubtotalThb: 0,
        shippingFeeThb: 0,
        finalTotalThb: 0,
        paymentStatus: "pending",
        slipSelected: true
      };

      expect(mapOrderToSheetRows(order).ordersRow[2]).toBe(
        university.sheetValue
      );
    });
  });

  it("labels a sheet value with its brand and short name for admin", () => {
    expect(getUniversityLabel("BANGMOD")).toBe("bm.swagclub · Bangmod");
    expect(getUniversityLabel("MAHASARAKHAM")).toBe(
      "msu.swagclub · Mahasarakham"
    );
    expect(getUniversityLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});
