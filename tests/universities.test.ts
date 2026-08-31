import { describe, expect, it, vi } from "vitest";
import {
  getAvailableDeliveryMethods,
  getProductsForUniversity,
  getUniversityById,
  isDeliveryMethodAllowed,
  universities,
  universityIds,
  universitySheetValues
} from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import { adminUniversities, getUniversityLabel } from "@/lib/admin-products";
import { validateAdminProductInput } from "@/lib/server/product-admin";

vi.mock("server-only", () => ({}));

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

  it("only allows pickup for Bangmod, while all other universities only support shipping", () => {
    expect(getAvailableDeliveryMethods("bangmod")).toEqual(["pickup", "shipping"]);
    expect(isDeliveryMethodAllowed("bangmod", "pickup")).toBe(true);
    expect(isDeliveryMethodAllowed("bangmod", "shipping")).toBe(true);

    universityIds
      .filter((id) => id !== "bangmod")
      .forEach((id) => {
        expect(getAvailableDeliveryMethods(id)).toEqual(["shipping"]);
        expect(isDeliveryMethodAllowed(id, "pickup")).toBe(false);
        expect(isDeliveryMethodAllowed(id, "shipping")).toBe(true);
      });
  });
});

describe("all eight universities work end to end", () => {
  it("loads and filters a product for every university", () => {
    const products: Product[] = universities.map((university, index) => ({
      id: `p-${university.id}`,
      primaryUniversityId: university.id,
      sellableUniversityIds: [university.id],
      name: `Colour ${index} Shirt`,
      colorName: `Colour ${index}`,
      priceThb: 390,
      image: "/products/product-placeholder.svg",
      availableSizes: ["M", "3XL"],
      active: true,
      sortOrder: index
    }));

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

  it("keeps canonical migrated database values for every university", () => {
    universities.forEach((university) => {
      expect(university.sheetValue).toBe(university.sheetValue.toUpperCase());
      expect(universitySheetValues).toContain(university.sheetValue);
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
