import "server-only";

import type { AdminProduct } from "@/lib/admin-products";
import {
  createAdminProduct,
  deleteAdminProduct,
  listAdminProducts,
  type RawProductInput,
  updateAdminProduct,
  validateAdminProductInput
} from "./product-admin";
import { ProductAdminError } from "./product-admin-error";
import {
  deleteProductImageBestEffort,
  uploadProductImage,
  type ProductImageCleanupStatus
} from "./product-image";
import { invalidateProductCatalogCache } from "./product-catalog";
import { listProductImageUrls } from "./supabase/product-image-repository";

export type ProductOperationDependencies = {
  listProducts: typeof listAdminProducts;
  createProduct: typeof createAdminProduct;
  updateProduct: typeof updateAdminProduct;
  deleteProduct: typeof deleteAdminProduct;
  listImageUrls: (productId: string) => Promise<string[]>;
  uploadImage: typeof uploadProductImage;
  deleteImage: typeof deleteProductImageBestEffort;
  invalidateCatalog: typeof invalidateProductCatalogCache;
};

const defaultDependencies: ProductOperationDependencies = {
  listProducts: listAdminProducts,
  createProduct: createAdminProduct,
  updateProduct: updateAdminProduct,
  deleteProduct: deleteAdminProduct,
  listImageUrls: listProductImageUrls,
  uploadImage: uploadProductImage,
  deleteImage: deleteProductImageBestEffort,
  invalidateCatalog: invalidateProductCatalogCache
};

export async function createAdminProductWithImage(
  raw: RawProductInput,
  image: File | null,
  dependencies: ProductOperationDependencies = defaultDependencies
) {
  if (!image) {
    throw new ProductAdminError("Upload a product image.", 400, {
      image: "Upload a product image."
    });
  }

  const validated = validateAdminProductInput({ ...raw, imageUrl: "/pending" });
  const existingProducts = await dependencies.listProducts();

  if (existingProducts.some((product) => product.productId === validated.productId)) {
    throw new ProductAdminError("PRODUCT_ID already exists.", 409, {
      productId: "PRODUCT_ID already exists."
    });
  }

  const imageUrl = await dependencies.uploadImage(validated.productId, image);

  let created;

  try {
    created = await dependencies.createProduct({ ...validated, imageUrl });
  } catch (error) {
    await dependencies.deleteImage(imageUrl);
    throw error;
  }

  invalidateCatalogSafely(dependencies.invalidateCatalog);
  return created;
}

export async function updateAdminProductWithOptionalImage(
  productId: string,
  raw: RawProductInput,
  image: File | null,
  dependencies: ProductOperationDependencies = defaultDependencies
) {
  const products = await dependencies.listProducts();
  const existing = products.find((product) => product.productId === productId);

  if (!existing) {
    throw new ProductAdminError("Product was not found.", 404);
  }

  const validated = validateAdminProductInput({
    ...raw,
    productId,
    imageUrl: existing.imageUrl
  });
  let nextImageUrl = existing.imageUrl;

  if (image) {
    nextImageUrl = await dependencies.uploadImage(productId, image);
  }

  let updated: AdminProduct;

  try {
    updated = await dependencies.updateProduct(productId, {
      ...validated,
      imageUrl: nextImageUrl
    });
  } catch (error) {
    if (nextImageUrl !== existing.imageUrl) {
      await dependencies.deleteImage(nextImageUrl);
    }
    throw error;
  }

  if (nextImageUrl !== existing.imageUrl) {
    await dependencies.deleteImage(existing.imageUrl);
  }

  invalidateCatalogSafely(dependencies.invalidateCatalog);
  return updated;
}

export type DeleteAdminProductResult = {
  product: AdminProduct;
  imageCleanup: ProductImageCleanupStatus;
  /** How many Blob assets the delete attempted to clean up. */
  imageCleanupCount: number;
};

/**
 * Permanently deletes a product, then cleans up its Blob image.
 *
 * Order matters and is deliberate:
 *   1. read the product so its IMAGE_URL is preserved before the row is gone
 *   2. delete the Products row — if this throws, nothing else has happened
 *      and the Blob image is left completely untouched
 *   3. only on success, best-effort Blob cleanup that can never roll the
 *      deletion back; a failure is reported to the admin, not thrown
 *
 * Orders and OrderItems are never touched: they store their own historical
 * snapshot of colour, size, quantity and unit price.
 */
export async function deleteAdminProductWithImageCleanup(
  productId: string,
  dependencies: ProductOperationDependencies = defaultDependencies
): Promise<DeleteAdminProductResult> {
  const products = await dependencies.listProducts();
  const existing = products.find((product) => product.productId === productId);

  if (!existing) {
    throw new ProductAdminError("Product was not found.", 404);
  }

  // 1. Collect every attached image while the rows still exist. A gallery
  //    read failure must not block the delete, so fall back to the cover.
  let imageUrls: string[] = [];

  try {
    imageUrls = await dependencies.listImageUrls(productId);
  } catch (error) {
    console.warn("Product gallery read failed before delete", {
      productId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
  }

  if (imageUrls.length === 0 && existing.imageUrl) {
    imageUrls = [existing.imageUrl];
  }

  // 2. Database first. A throw here propagates and skips cleanup entirely.
  //    product_images rows go with it via ON DELETE CASCADE.
  await dependencies.deleteProduct(productId);

  // 3. Committed. Blob cleanup is advisory from here on and can never
  //    resurrect or corrupt the database state.
  const results = await Promise.all(
    imageUrls.map((url) => dependencies.deleteImage(url))
  );

  invalidateCatalogSafely(dependencies.invalidateCatalog);

  return {
    product: existing,
    imageCleanup: summarizeCleanup(results.map((result) => result.status)),
    imageCleanupCount: results.length
  };
}

/**
 * One status for the whole gallery: any failure is reported, otherwise a
 * delete wins over a skip so the admin sees the meaningful outcome.
 */
function summarizeCleanup(
  statuses: ProductImageCleanupStatus[]
): ProductImageCleanupStatus {
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (statuses.some((status) => status === "deleted")) {
    return "deleted";
  }

  return "skipped";
}

function invalidateCatalogSafely(invalidate: () => void) {
  try {
    invalidate();
  } catch (error) {
    console.warn("Product catalog cache invalidation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
  }
}
