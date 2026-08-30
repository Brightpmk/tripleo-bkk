import "server-only";

import {
  productImagePlaceholder,
  type Product,
  type UniversityId
} from "@/lib/catalog";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { readProductRows } from "./google-sheets";

export type ProductSheetCell = string | number | boolean | null | undefined;
export type ProductSheetRow = ProductSheetCell[];

export class ProductCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductCatalogError";
  }
}

const productHeaders = [
  "PRODUCT_ID",
  "UNIVERSITY",
  "SHIRT_COLOR",
  "PRICE",
  "IMAGE_URL",
  "AVAILABLE_SIZES",
  "ACTIVE",
  "SORT_ORDER"
] as const;

type ProductHeader = (typeof productHeaders)[number];
type ProductHeaderMap = Record<ProductHeader, number>;

const universityBySheetValue: Record<string, UniversityId> = {
  BANGMOD: "bangmod",
  LADKRABANG: "ladkrabang",
  "NORTH BANGKOK": "north-bangkok"
};

export const PRODUCT_CATALOG_CACHE_TAG = "swagclub-product-catalog";

const loadCachedProductCatalog = unstable_cache(
  async () => normalizeProductRows(await readProductRows()),
  ["swagclub-product-catalog-v1"],
  {
    revalidate: 60,
    tags: [PRODUCT_CATALOG_CACHE_TAG]
  }
);

export async function getCachedProductCatalog() {
  return loadCachedProductCatalog();
}

export function invalidateProductCatalogCache() {
  revalidateTag(PRODUCT_CATALOG_CACHE_TAG, { expire: 0 });
  revalidatePath("/", "page");
}

export function normalizeProductRows(rows: ProductSheetRow[]) {
  if (rows.length === 0) {
    throw new ProductCatalogError("Products sheet is empty.");
  }

  const headerMap = buildProductHeaderMap(rows[0]);
  const products: Product[] = [];
  const seenProductIds = new Set<string>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeProductRow(row, headerMap, rowNumber);

    if (!normalized) {
      return;
    }

    if (seenProductIds.has(normalized.id)) {
      throw new ProductCatalogError(
        `Products sheet contains duplicate PRODUCT_ID: ${normalized.id}`
      );
    }

    seenProductIds.add(normalized.id);
    products.push(normalized);
  });

  return products.sort(compareProducts);
}

function buildProductHeaderMap(headerRow: ProductSheetRow): ProductHeaderMap {
  const normalizedHeaders = headerRow.map((cell) =>
    normalizeHeader(cellToString(cell))
  );
  const missing = productHeaders.filter(
    (header) => !normalizedHeaders.includes(header)
  );

  if (missing.length > 0) {
    throw new ProductCatalogError(
      `Products sheet is missing required headers: ${missing.join(", ")}`
    );
  }

  return Object.fromEntries(
    productHeaders.map((header) => [header, normalizedHeaders.indexOf(header)])
  ) as ProductHeaderMap;
}

function normalizeProductRow(
  row: ProductSheetRow,
  headerMap: ProductHeaderMap,
  rowNumber: number
): Product | null {
  const productId = cellToString(row[headerMap.PRODUCT_ID]);
  const colorName = cellToString(row[headerMap.SHIRT_COLOR]);
  const active = parseActive(row[headerMap.ACTIVE]);

  if (active !== true) {
    return null;
  }

  if (!productId) {
    logSkippedProduct(rowNumber, "missing PRODUCT_ID");
    return null;
  }

  if (!colorName) {
    logSkippedProduct(rowNumber, "missing SHIRT_COLOR", productId);
    return null;
  }

  const universityId = parseUniversity(row[headerMap.UNIVERSITY]);

  if (!universityId) {
    logSkippedProduct(rowNumber, "unsupported UNIVERSITY", productId);
    return null;
  }

  const priceThb = parsePrice(row[headerMap.PRICE]);

  if (priceThb === null) {
    logSkippedProduct(rowNumber, "invalid PRICE", productId);
    return null;
  }

  const availableSizes = parseAvailableSizes(row[headerMap.AVAILABLE_SIZES]);

  if (availableSizes.length === 0) {
    logSkippedProduct(rowNumber, "missing AVAILABLE_SIZES", productId);
    return null;
  }

  return {
    id: productId,
    primaryUniversityId: universityId,
    sellableUniversityIds: [universityId],
    name: `${colorName} Shirt`,
    colorName,
    priceThb,
    image: normalizeImageUrl(row[headerMap.IMAGE_URL]),
    availableSizes,
    active: true,
    sortOrder: parseSortOrder(row[headerMap.SORT_ORDER])
  };
}

function parseUniversity(value: ProductSheetCell): UniversityId | null {
  const normalized = normalizeHeader(cellToString(value));

  return universityBySheetValue[normalized] ?? null;
}

function parsePrice(value: ProductSheetCell) {
  const raw = cellToString(value).replace(/,/g, "").replace(/\bTHB\b/i, "");
  const price = Number(raw.trim());

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return price;
}

function parseAvailableSizes(value: ProductSheetCell) {
  const seen = new Set<string>();

  return cellToString(value)
    .split(",")
    .map((size) => size.trim())
    .filter((size) => {
      if (!size || seen.has(size)) {
        return false;
      }

      seen.add(size);
      return true;
    });
}

function parseActive(value: ProductSheetCell) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = cellToString(value).toLowerCase();

  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", ""].includes(normalized)) {
    return false;
  }

  return false;
}

function parseSortOrder(value: ProductSheetCell) {
  const raw = cellToString(value).replace(/,/g, "");
  const sortOrder = Number(raw);

  return raw && Number.isFinite(sortOrder)
    ? sortOrder
    : Number.MAX_SAFE_INTEGER;
}

function normalizeImageUrl(value: ProductSheetCell) {
  const raw = cellToString(value);

  if (!raw) {
    return productImagePlaceholder;
  }

  if (raw.startsWith("/")) {
    return raw;
  }

  try {
    const url = new URL(raw);

    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {
    return productImagePlaceholder;
  }

  return productImagePlaceholder;
}

function compareProducts(a: Product, b: Product) {
  return (
    a.sortOrder - b.sortOrder ||
    a.primaryUniversityId.localeCompare(b.primaryUniversityId) ||
    a.colorName.localeCompare(b.colorName) ||
    a.id.localeCompare(b.id)
  );
}

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function cellToString(value: ProductSheetCell) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function logSkippedProduct(rowNumber: number, reason: string, productId?: string) {
  console.warn("Skipping Products row", {
    rowNumber,
    reason,
    productId
  });
}
