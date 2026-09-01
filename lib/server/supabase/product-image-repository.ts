import "server-only";

import { ProductAdminError } from "../product-admin-error";
import { getSupabaseServiceClient } from "./client";

/**
 * Relational product images.
 *
 * `products.image_url` is retained as a denormalised mirror of the primary
 * (lowest sort_order) image. That is what keeps the catalog a single query:
 * listing pages read the cover straight off the product row and never touch
 * this table. Only the product detail page loads a full gallery.
 *
 * Every mutation here re-syncs the mirror so the two can never drift.
 */

export type ProductImageRow = {
  id: string;
  productId: string;
  imageUrl: string;
  sortOrder: number;
};

type RawProductImageRow = {
  id: string;
  product_id: string;
  image_url: string;
  sort_order: number;
};

const imageColumns = "id, product_id, image_url, sort_order";

export async function listProductImages(
  productId: string
): Promise<ProductImageRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_images")
    .select(imageColumns)
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw imageWriteError(error, "Product images could not be loaded.");
  }

  return ((data ?? []) as RawProductImageRow[]).map(toProductImage);
}

/**
 * Batch read for several products at once — never one query per product.
 * Returns a map keyed by product_id with each gallery already in order.
 */
export async function listProductImagesFor(
  productIds: string[]
): Promise<Map<string, ProductImageRow[]>> {
  const grouped = new Map<string, ProductImageRow[]>();

  if (productIds.length === 0) {
    return grouped;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_images")
    .select(imageColumns)
    .in("product_id", productIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw imageWriteError(error, "Product images could not be loaded.");
  }

  for (const raw of (data ?? []) as RawProductImageRow[]) {
    const image = toProductImage(raw);
    const existing = grouped.get(image.productId);

    if (existing) {
      existing.push(image);
    } else {
      grouped.set(image.productId, [image]);
    }
  }

  return grouped;
}

/** Appends an image to the end of the gallery. */
export async function addProductImage(productId: string, imageUrl: string) {
  const supabase = getSupabaseServiceClient();
  const existing = await listProductImages(productId);
  const nextSortOrder =
    existing.reduce((max, image) => Math.max(max, image.sortOrder), 0) + 1;

  const { error } = await supabase
    .from("product_images")
    .insert({
      product_id: productId,
      image_url: imageUrl,
      sort_order: nextSortOrder
    });

  if (error) {
    throw imageWriteError(error, "The image could not be saved.");
  }

  await syncPrimaryImage(productId);
}

export async function deleteProductImage(productId: string, imageUrl: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("product_images")
    .delete()
    .eq("product_id", productId)
    .eq("image_url", imageUrl)
    .select("id")
    .maybeSingle();

  if (error) {
    throw imageWriteError(error, "The image could not be removed.");
  }

  if (!data) {
    throw new ProductAdminError("That image was not found.", 404);
  }

  // Close the gap left behind so ordering stays 1..n.
  await resequence(productId);
  await syncPrimaryImage(productId);
}

/**
 * Rewrites the whole ordering in one statement. The first URL becomes the
 * primary image. Unknown URLs are ignored rather than inserted.
 */
export async function setProductImageOrder(
  productId: string,
  imageUrls: string[]
) {
  if (imageUrls.length === 0) {
    return;
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("set_product_image_order", {
    p_product_id: productId,
    p_image_urls: imageUrls
  });

  if (error) {
    throw imageWriteError(error, "Image order could not be saved.");
  }
}

/** Every Blob URL attached to a product, for cleanup before deletion. */
export async function listProductImageUrls(productId: string) {
  return (await listProductImages(productId)).map((image) => image.imageUrl);
}

async function resequence(productId: string) {
  const images = await listProductImages(productId);

  if (images.length === 0) {
    return;
  }

  await setProductImageOrder(
    productId,
    images.map((image) => image.imageUrl)
  );
}

/**
 * Keeps products.image_url equal to the first gallery image (or null when the
 * gallery is empty), so the catalog's single-query read stays correct.
 */
async function syncPrimaryImage(productId: string) {
  const supabase = getSupabaseServiceClient();
  const images = await listProductImages(productId);
  const primary = images[0]?.imageUrl ?? null;

  const { error } = await supabase
    .from("products")
    .update({ image_url: primary })
    .eq("product_id", productId);

  if (error) {
    throw imageWriteError(error, "The product cover image could not be updated.");
  }
}

function toProductImage(raw: RawProductImageRow): ProductImageRow {
  return {
    id: raw.id,
    productId: raw.product_id,
    imageUrl: raw.image_url,
    sortOrder: raw.sort_order
  };
}

function imageWriteError(error: unknown, fallbackMessage: string) {
  if (isSupabaseError(error) && error.code === "23505") {
    return new ProductAdminError(
      "That image is already attached to this product.",
      409,
      { image: "That image is already attached to this product." }
    );
  }

  // Supabase/Postgres internals never reach the admin browser.
  console.error("Product image write failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });

  return new ProductAdminError(fallbackMessage, 500);
}

function isSupabaseError(error: unknown): error is { code?: string } {
  return Boolean(error && typeof error === "object" && "code" in error);
}
