import {
  universities,
  universitySheetValues,
  type UniversitySheetValue
} from "./catalog";

/**
 * Admin writes the canonical UNIVERSITY value into Products.UNIVERSITY, so this
 * list preserves the imported Google Sheets values verbatim.
 */
export const adminUniversities = universitySheetValues;

export type AdminUniversity = UniversitySheetValue;

export const adminProductSizes = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL"
] as const;

export type AdminProduct = {
  productId: string;
  university: AdminUniversity;
  shirtColor: string;
  priceThb: number;
  imageUrl: string;
  availableSizes: string[];
  active: boolean;
  sortOrder: number;
};

export type AdminProductInput = AdminProduct;

/**
 * Admin-facing label for a canonical sheet value, e.g.
 * "BANGMOD" -> "bm.swagclub · Bangmod". The stored value never changes.
 */
export function getUniversityLabel(sheetValue: string) {
  const match = universities.find(
    (university) => university.sheetValue === sheetValue
  );

  return match ? `${match.brand} · ${match.shortName}` : sheetValue;
}
