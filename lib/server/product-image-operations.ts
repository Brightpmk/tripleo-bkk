import "server-only";

import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { getBlobStoreEnv } from "./env";
import { ProductAdminError } from "./product-admin-error";
import { optimizeProductImageForStorefront } from "./product-image-pipeline";
import {
  deleteProductImageBestEffort,
  isProductImageBlobUrl
} from "./product-image";
import {
  addProductImage,
  deleteProductImage,
  listProductImages,
  setProductImageOrder,
  type ProductImageRow
} from "./supabase/product-image-repository";
import { invalidateProductCatalogCache } from "./product-catalog";

/**
 * Gallery mutations: optimise, upload, record, and keep Blob and Postgres
 * from drifting apart.
 *
 * The ordering rule throughout is: never leave a database row pointing at a
 * Blob that does not exist, and never leave a Blob that no row references
 * without at least trying to delete it.
 */

export type ProductImageOperationDependencies = {
  optimize: typeof optimizeProductImageForStorefront;
  uploadBlob: (input: {
    productId: string;
    buffer: Buffer;
    contentType: string;
    extension: string;
  }) => Promise<string>;
  addImage: typeof addProductImage;
  removeImage: typeof deleteProductImage;
  listImages: typeof listProductImages;
  reorderImages: typeof setProductImageOrder;
  deleteBlob: typeof deleteProductImageBestEffort;
  invalidateCatalog: typeof invalidateProductCatalogCache;
};

const defaultDependencies: ProductImageOperationDependencies = {
  optimize: optimizeProductImageForStorefront,
  uploadBlob: uploadOptimizedImage,
  addImage: addProductImage,
  removeImage: deleteProductImage,
  listImages: listProductImages,
  reorderImages: setProductImageOrder,
  deleteBlob: deleteProductImageBestEffort,
  invalidateCatalog: invalidateProductCatalogCache
};

export type UploadedProductImage = {
  imageUrl: string;
  width: number;
  height: number;
  bytes: number;
  sourceBytes: number;
};

export type ProductImageUploadOutcome =
  | { ok: true; fileName: string; image: UploadedProductImage }
  | { ok: false; fileName: string; message: string };

export type ProductImageUploadResult = {
  uploaded: ProductImageUploadOutcome[];
  images: ProductImageRow[];
};

/**
 * Uploads a batch of files. Each file is independent: one bad file reports
 * its own error and the rest still land, rather than failing the whole batch.
 */
export async function addProductImages(
  productId: string,
  files: File[],
  dependencies: ProductImageOperationDependencies = defaultDependencies
): Promise<ProductImageUploadResult> {
  if (files.length === 0) {
    throw new ProductAdminError("Choose at least one image to upload.", 400, {
      image: "Choose at least one image to upload."
    });
  }

  const uploaded: ProductImageUploadOutcome[] = [];

  for (const file of files) {
    const fileName = file.name || "image";
    let imageUrl = "";

    try {
      const optimized = await dependencies.optimize(file);

      imageUrl = await dependencies.uploadBlob({
        productId,
        buffer: optimized.buffer,
        contentType: optimized.contentType,
        extension: optimized.extension
      });

      try {
        await dependencies.addImage(productId, imageUrl);
      } catch (error) {
        // The row failed, so the Blob we just wrote is now an orphan.
        await dependencies.deleteBlob(imageUrl);
        throw error;
      }

      uploaded.push({
        ok: true,
        fileName,
        image: {
          imageUrl,
          width: optimized.width,
          height: optimized.height,
          bytes: optimized.bytes,
          sourceBytes: optimized.sourceBytes
        }
      });
    } catch (error) {
      uploaded.push({
        ok: false,
        fileName,
        message: toSafeMessage(error, "That image could not be uploaded.")
      });
    }
  }

  invalidateCatalogSafely(dependencies.invalidateCatalog);

  return { uploaded, images: await dependencies.listImages(productId) };
}

/**
 * Removes one image. The row goes first: if the Blob delete then fails the
 * gallery is still correct, and cleanup is a storage chore rather than a
 * correctness problem.
 */
export async function removeProductImage(
  productId: string,
  imageUrl: string,
  dependencies: ProductImageOperationDependencies = defaultDependencies
) {
  if (!imageUrl.trim()) {
    throw new ProductAdminError("That image was not found.", 404);
  }

  await dependencies.removeImage(productId, imageUrl);

  const cleanup = await dependencies.deleteBlob(imageUrl);

  invalidateCatalogSafely(dependencies.invalidateCatalog);

  return {
    imageCleanup: cleanup.status,
    images: await dependencies.listImages(productId)
  };
}

/** Reorders the gallery. The first URL becomes the primary image. */
export async function reorderProductImages(
  productId: string,
  imageUrls: string[],
  dependencies: ProductImageOperationDependencies = defaultDependencies
) {
  const existing = await dependencies.listImages(productId);
  const known = new Set(existing.map((image) => image.imageUrl));
  const requested = imageUrls.filter((url) => known.has(url));

  if (requested.length !== existing.length) {
    throw new ProductAdminError(
      "The image order did not match this product's images.",
      400
    );
  }

  await dependencies.reorderImages(productId, requested);
  invalidateCatalogSafely(dependencies.invalidateCatalog);

  return { images: await dependencies.listImages(productId) };
}

async function uploadOptimizedImage(input: {
  productId: string;
  buffer: Buffer;
  contentType: string;
  extension: string;
}) {
  const pathname = [
    "products",
    input.productId,
    `${Date.now()}-${randomUUID()}.${input.extension}`
  ].join("/");

  try {
    const blob = await put(pathname, input.buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: input.contentType,
      // Existing OIDC auth. No BLOB_READ_WRITE_TOKEN anywhere.
      storeId: getBlobStoreEnv().BLOB_STORE_ID
    });

    return blob.url;
  } catch (error) {
    console.error("Product image upload failed", {
      productId: input.productId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    throw new ProductAdminError(
      "The image could not be uploaded to storage. Please try again.",
      502,
      { image: "The image could not be uploaded to storage. Please try again." }
    );
  }
}

export { isProductImageBlobUrl };

function toSafeMessage(error: unknown, fallback: string) {
  if (error instanceof ProductAdminError) {
    return error.message;
  }

  console.error("Product image operation failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });

  return fallback;
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
