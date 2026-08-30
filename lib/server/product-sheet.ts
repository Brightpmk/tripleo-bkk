import type { AdminProductInput } from "@/lib/admin-products";
import { ProductAdminError } from "./product-admin-error";

export const PRODUCT_SHEET_HEADERS = [
  "PRODUCT_ID",
  "UNIVERSITY",
  "SHIRT_COLOR",
  "PRICE",
  "IMAGE_URL",
  "AVAILABLE_SIZES",
  "ACTIVE",
  "SORT_ORDER"
] as const;

export type ProductSheetHeader = (typeof PRODUCT_SHEET_HEADERS)[number];

export function getProductHeaderMap(headerRow: unknown[]) {
  const normalized = headerRow.map((cell) =>
    cellString(cell).replace(/\s+/g, " ").toUpperCase()
  );
  const missing = PRODUCT_SHEET_HEADERS.filter(
    (header) => !normalized.includes(header)
  );

  if (missing.length > 0) {
    throw new ProductAdminError("Products sheet schema is invalid.", 500);
  }

  return Object.fromEntries(
    PRODUCT_SHEET_HEADERS.map((header) => [header, normalized.indexOf(header)])
  ) as Record<ProductSheetHeader, number>;
}

export function productToSheetRow(
  product: AdminProductInput,
  headerRow: unknown[],
  existingRow: unknown[] = []
) {
  const map = getProductHeaderMap(headerRow);
  const row = Array.from(
    { length: Math.max(headerRow.length, existingRow.length) },
    (_, index) => existingRow[index] ?? ""
  );

  row[map.PRODUCT_ID] = product.productId;
  row[map.UNIVERSITY] = product.university;
  row[map.SHIRT_COLOR] = product.shirtColor;
  row[map.PRICE] = product.priceThb;
  row[map.IMAGE_URL] = product.imageUrl;
  row[map.AVAILABLE_SIZES] = product.availableSizes.join(",");
  row[map.ACTIVE] = product.active ? "TRUE" : "FALSE";
  row[map.SORT_ORDER] = product.sortOrder;

  return row;
}

function cellString(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}
