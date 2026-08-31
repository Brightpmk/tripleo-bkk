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

export type ProductOperationDependencies = {
  listProducts: typeof listAdminProducts;
  createProduct: typeof createAdminProduct;
  updateProduct: typeof updateAdminProduct;
  deleteProduct: typeof deleteAdminProduct;
  uploadImage: typeof uploadProductImage;
  deleteImage: typeof deleteProductImageBestEffort;
  invalidateCatalog: typeof invalidateProductCatalogCache;
};

const defaultDependencies: ProductOperationDependencies = {
  listProducts: listAdminProducts,
  createProduct: createAdminProduct,
  updateProduct: updateAdminProduct,
  deleteProduct: deleteAdminProduct,
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

  // 1. Preserve the image URL while the row still exists.
  const imageUrl = existing.imageUrl;

  // 2. Database first. A throw here propagates and skips cleanup entirely.
  await dependencies.deleteProduct(productId);

  // 3. Committed. Cleanup is advisory from here on.
  const cleanup = await dependencies.deleteImage(imageUrl);

  invalidateCatalogSafely(dependencies.invalidateCatalog);

  return { product: existing, imageCleanup: cleanup.status };
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
