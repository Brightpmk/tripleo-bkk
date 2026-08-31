import "server-only";

import {
  adminProductSizes,
  adminUniversities,
  type AdminProductInput,
  type AdminUniversity
} from "@/lib/admin-products";
import { ProductAdminError } from "./product-admin-error";
import {
  createSupabaseProduct,
  deleteSupabaseProduct,
  listSupabaseProducts,
  updateSupabaseProduct
} from "./supabase/product-repository";

export { ProductAdminError } from "./product-admin-error";
export type RawProductInput = Record<string, unknown>;

const productIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export async function listAdminProducts() {
  return listSupabaseProducts();
}

export async function createAdminProduct(raw: RawProductInput) {
  const product = validateAdminProductInput(raw);
  await createSupabaseProduct(product);
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

  await updateSupabaseProduct(productId, product);
  return product;
}

export async function deleteAdminProduct(productId: string) {
  if (!isValidProductId(productId)) {
    throw new ProductAdminError("Product was not found.", 404);
  }

  await deleteSupabaseProduct(productId);
}

export function isValidProductId(value: unknown) {
  return productIdPattern.test(typeof value === "string" ? value.trim() : "");
}

export function validateAdminProductInput(raw: RawProductInput): AdminProductInput {
  const fieldErrors: Record<string, string> = {};
  const productId = asTrimmedString(raw.productId);
  const university = asTrimmedString(raw.university).toUpperCase();
  const shirtColor = asTrimmedString(raw.shirtColor);
  const priceThb = parseFiniteNumber(raw.priceThb);
  const imageUrl = asTrimmedString(raw.imageUrl);
  const availableSizes = normalizeSubmittedSizes(raw.availableSizes);
  const active = parseSubmittedBoolean(raw.active);
  const sortOrder = parseFiniteNumber(raw.sortOrder);

  if (!productIdPattern.test(productId)) {
    fieldErrors.productId =
      "Use 3–64 letters, numbers, hyphens, or underscores.";
  }

  if (!adminUniversities.includes(university as AdminUniversity)) {
    fieldErrors.university = "Select a supported university.";
  }

  if (!shirtColor || shirtColor.length > 80) {
    fieldErrors.shirtColor = "Enter a shirt color up to 80 characters.";
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
    shirtColor,
    priceThb: priceThb as number,
    imageUrl,
    availableSizes: availableSizes as string[],
    active: active as boolean,
    sortOrder: sortOrder as number
  };
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

function asTrimmedString(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}
