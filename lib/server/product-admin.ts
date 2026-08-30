import "server-only";

import {
  adminProductSizes,
  adminUniversities,
  type AdminProduct,
  type AdminProductInput,
  type AdminUniversity
} from "@/lib/admin-products";
import { productImagePlaceholder } from "@/lib/catalog";
import {
  appendProductRow,
  readProductRows,
  updateProductRow
} from "./google-sheets";
import { ProductAdminError } from "./product-admin-error";
import { getProductHeaderMap } from "./product-sheet";

export { ProductAdminError } from "./product-admin-error";
export type RawProductInput = Record<string, unknown>;

export async function listAdminProducts() {
  return normalizeAdminProductRows(await readProductRows());
}

export async function createAdminProduct(raw: RawProductInput) {
  const product = validateAdminProductInput(raw);
  await appendProductRow(product);
  return product;
}

export async function updateAdminProduct(
  productId: string,
  raw: RawProductInput
) {
  const product = validateAdminProductInput({ ...raw, productId });

  if (product.productId !== productId) {
    throw new ProductAdminError("Product ID cannot be changed.", 400, {
      productId: "Product ID cannot be changed."
    });
  }

  await updateProductRow(productId, product);
  return product;
}

export function validateAdminProductInput(raw: RawProductInput): AdminProductInput {
  const fieldErrors: Record<string, string> = {};
  const productId = asTrimmedString(raw.productId);
  const university = asTrimmedString(raw.university).toUpperCase();
  const jerseyColor = asTrimmedString(raw.jerseyColor);
  const priceThb = parseFiniteNumber(raw.priceThb);
  const imageUrl = asTrimmedString(raw.imageUrl);
  const availableSizes = normalizeSubmittedSizes(raw.availableSizes);
  const active = parseSubmittedBoolean(raw.active);
  const sortOrder = parseFiniteNumber(raw.sortOrder);

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(productId)) {
    fieldErrors.productId =
      "Use 3–64 letters, numbers, hyphens, or underscores.";
  }

  if (!adminUniversities.includes(university as AdminUniversity)) {
    fieldErrors.university = "Select a supported university.";
  }

  if (!jerseyColor || jerseyColor.length > 80) {
    fieldErrors.jerseyColor = "Enter a jersey color up to 80 characters.";
  }

  if (
    priceThb === null ||
    priceThb <= 0 ||
    priceThb > 1_000_000 ||
    !hasAtMostTwoDecimals(priceThb)
  ) {
    fieldErrors.priceThb = "Enter a positive THB price with up to 2 decimals.";
  }

  if (!isValidImageUrl(imageUrl)) {
    fieldErrors.imageUrl = "Upload a valid product image.";
  }

  if (!availableSizes) {
    fieldErrors.availableSizes = "Select at least one valid size.";
  }

  if (active === null) {
    fieldErrors.active = "Select a valid active status.";
  }

  if (
    sortOrder === null ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 999_999
  ) {
    fieldErrors.sortOrder = "Enter a whole sort order from 0 to 999999.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new ProductAdminError(
      "Check the highlighted product fields.",
      400,
      fieldErrors
    );
  }

  return {
    productId,
    university: university as AdminUniversity,
    jerseyColor,
    priceThb: priceThb as number,
    imageUrl,
    availableSizes: availableSizes as string[],
    active: active as boolean,
    sortOrder: sortOrder as number
  };
}

export function normalizeAdminProductRows(rows: unknown[][]): AdminProduct[] {
  if (rows.length === 0) {
    throw new ProductAdminError("Products sheet is unavailable.", 500);
  }

  const headerMap = getProductHeaderMap(rows[0]);
  const products = rows.slice(1).flatMap((row) => {
    const productId = cellString(row[headerMap.PRODUCT_ID]);

    if (!productId) return [];

    return [
      validateAdminProductInput({
        productId,
        university: row[headerMap.UNIVERSITY],
        jerseyColor: row[headerMap.JERSEY_COLOR],
        priceThb: row[headerMap.PRICE],
        imageUrl: normalizeAdminImageUrl(row[headerMap.IMAGE_URL]),
        availableSizes: cellString(row[headerMap.AVAILABLE_SIZES]).split(","),
        active: row[headerMap.ACTIVE],
        sortOrder: row[headerMap.SORT_ORDER]
      })
    ];
  });

  return products.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.university.localeCompare(b.university) ||
      a.jerseyColor.localeCompare(b.jerseyColor) ||
      a.productId.localeCompare(b.productId)
  );
}

function normalizeSubmittedSizes(value: unknown) {
  if (!Array.isArray(value)) return null;

  const normalized = Array.from(
    new Set(value.map(asTrimmedString).filter(Boolean))
  );

  if (
    normalized.length === 0 ||
    normalized.some((size) => !adminProductSizes.includes(size as never))
  ) {
    return null;
  }

  return adminProductSizes.filter((size) => normalized.includes(size));
}

function parseSubmittedBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = asTrimmedString(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function parseFiniteNumber(value: unknown) {
  const normalized =
    typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const number = Number(normalized);
  return normalized !== "" && Number.isFinite(number) ? number : null;
}

function hasAtMostTwoDecimals(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

function isValidImageUrl(value: string) {
  if (value.startsWith("/")) return true;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAdminImageUrl(value: unknown) {
  const imageUrl = asTrimmedString(value);

  return isValidImageUrl(imageUrl) ? imageUrl : productImagePlaceholder;
}

function asTrimmedString(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cellString(value: unknown) {
  return asTrimmedString(value);
}
