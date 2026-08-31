import "server-only";

import type { AdminProduct, AdminProductInput } from "@/lib/admin-products";
import {
  productImagePlaceholder,
  universities,
  type Product,
  type UniversityId
} from "@/lib/catalog";
import { ProductAdminError } from "../product-admin-error";
import {
  getSupabaseServiceClient,
  type SupabaseProductRow
} from "./client";

export async function listSupabaseProducts(): Promise<AdminProduct[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("product_id, university, shirt_color, base_price_thb, image_url, available_sizes, active, sort_order")
    .order("sort_order", { ascending: true })
    .order("university", { ascending: true })
    .order("shirt_color", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SupabaseProductRow[]).map((product) => ({
    productId: product.product_id,
    university: product.university as AdminProduct["university"],
    shirtColor: product.shirt_color,
    priceThb: product.base_price_thb,
    imageUrl: product.image_url ?? "",
    availableSizes: product.available_sizes,
    active: product.active,
    sortOrder: product.sort_order
  }));
}

export async function listActiveSupabaseCatalog(): Promise<Product[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("product_id, university, shirt_color, base_price_thb, image_url, available_sizes, active, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("university", { ascending: true })
    .order("shirt_color", { ascending: true })
    .order("product_id", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SupabaseProductRow[]).flatMap(toStorefrontProduct);
}

export async function createSupabaseProduct(product: AdminProductInput) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("products")
    .insert(toProductRow(product));

  if (error) {
    throw productWriteError(error, "Product could not be created.");
  }
}

export async function updateSupabaseProduct(
  productId: string,
  product: AdminProductInput
) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .update(toProductRow(product))
    .eq("product_id", productId)
    .select("product_id")
    .maybeSingle();

  if (error) {
    throw productWriteError(error, "Product could not be updated.");
  }

  if (!data) {
    throw new ProductAdminError("Product was not found.", 404);
  }
}

export async function deleteSupabaseProduct(productId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("product_id", productId)
    .select("product_id")
    .maybeSingle();

  if (error) {
    throw productWriteError(error, "Product could not be deleted.");
  }

  if (!data) {
    throw new ProductAdminError("Product was not found.", 404);
  }
}

function toProductRow(product: AdminProductInput) {
  return {
    product_id: product.productId,
    university: product.university,
    shirt_color: product.shirtColor,
    base_price_thb: product.priceThb,
    image_url: product.imageUrl || null,
    available_sizes: product.availableSizes,
    active: product.active,
    sort_order: product.sortOrder
  };
}

function toStorefrontProduct(product: SupabaseProductRow): Product[] {
  const university = getUniversityBySheetValue(product.university);

  if (!university) {
    console.warn("Skipping Supabase product with unsupported university", {
      productId: product.product_id
    });
    return [];
  }

  return [
    {
      id: product.product_id,
      primaryUniversityId: university.id,
      sellableUniversityIds: [university.id],
      name: `${product.shirt_color} Shirt`,
      colorName: product.shirt_color,
      priceThb: product.base_price_thb,
      image: normalizeImageUrl(product.image_url),
      availableSizes: product.available_sizes,
      active: product.active,
      sortOrder: product.sort_order
    }
  ];
}

function getUniversityBySheetValue(value: string): { id: UniversityId } | null {
  const normalized = value.trim().toUpperCase();
  const university = universities.find(
    (candidate) => candidate.sheetValue.toUpperCase() === normalized
  );

  return university ? { id: university.id } : null;
}

function normalizeImageUrl(value: string | null) {
  const raw = value?.trim() ?? "";

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

function productWriteError(error: unknown, fallbackMessage: string) {
  if (isSupabaseError(error) && error.code === "23505") {
    return new ProductAdminError("PRODUCT_ID already exists.", 409, {
      productId: "PRODUCT_ID already exists."
    });
  }

  return new ProductAdminError(fallbackMessage, 500);
}

function isSupabaseError(error: unknown): error is { code?: string } {
  return Boolean(error && typeof error === "object" && "code" in error);
}
