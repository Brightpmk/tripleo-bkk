import "server-only";

import { del, put } from "@vercel/blob";
import type { DeleteCommandOptions, PutCommandOptions } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { getBlobStoreEnv } from "./env";
import { MAX_PRODUCT_IMAGE_BYTES } from "../product-image-limits";
import { ProductAdminError } from "./product-admin-error";

export {
  MAX_PRODUCT_IMAGE_BYTES,
  VERCEL_REQUEST_BODY_LIMIT_BYTES
} from "../product-image-limits";

/** Every product image this app writes lives under this Blob prefix. */
export const PRODUCT_IMAGE_BLOB_PREFIX = "products/";

export type ProductImageCleanup =
  | { status: "deleted" }
  | { status: "skipped"; reason: "no-image" | "not-product-blob-storage" }
  | { status: "failed" };

export type ProductImageCleanupStatus = ProductImageCleanup["status"];

const extensionByType = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

type BlobOidcOptions = Pick<PutCommandOptions, "oidcToken" | "storeId">;

export async function validateProductImage(file: File) {
  const extension = extensionByType[file.type as keyof typeof extensionByType];

  if (!extension) {
    throw imageError("Choose a PNG, JPEG, or WEBP image.");
  }

  if (file.size <= 0) {
    throw imageError("That image file is empty.");
  }

  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw imageError(
      "That image is too large to upload. Pick the image again so it can be optimised, or resize it first."
    );
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  // Content, not the declared type, decides. A renamed file is rejected.
  if (!matchesImageSignature(file.type, bytes)) {
    throw imageError(
      "That file is not a valid PNG, JPEG, or WEBP image."
    );
  }

  return extension;
}

function imageError(message: string) {
  return new ProductAdminError(message, 400, { image: message });
}

export async function uploadProductImage(
  productId: string,
  file: File,
  options: {
    putBlob?: typeof put;
    blobAuth?: BlobOidcOptions;
    now?: () => number;
    randomId?: () => string;
  } = {}
) {
  const extension = await validateProductImage(file);
  const pathname = [
    "products",
    productId,
    `${(options.now ?? Date.now)()}-${(options.randomId ?? randomUUID)()}.${extension}`
  ].join("/");
  const blobAuth = getBlobOidcOptions(options.blobAuth);

  try {
    const blob = await (options.putBlob ?? put)(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type,
      ...blobAuth
    });

    return blob.url;
  } catch (error) {
    // Blob/credential internals never reach the admin browser.
    console.error("Product image upload failed", {
      productId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    throw new ProductAdminError(
      "The image could not be uploaded to storage. Please try again.",
      502,
      { image: "The image could not be uploaded to storage. Please try again." }
    );
  }
}

/**
 * Best-effort Blob cleanup. Never throws: the caller has already committed
 * the Sheet change, so a storage failure must not roll that back. Only ever
 * touches this app's own product-image prefix in Vercel Blob — a blank,
 * relative, placeholder, or external URL is skipped.
 */
export async function deleteProductImageBestEffort(
  imageUrl: string,
  options: { deleteBlob?: typeof del; blobAuth?: Pick<DeleteCommandOptions, "oidcToken" | "storeId"> } = {}
): Promise<ProductImageCleanup> {
  if (!imageUrl.trim()) {
    return { status: "skipped", reason: "no-image" };
  }

  if (!isProductImageBlobUrl(imageUrl)) {
    return { status: "skipped", reason: "not-product-blob-storage" };
  }

  try {
    const blobAuth = getBlobOidcOptions(options.blobAuth);
    await (options.deleteBlob ?? del)(imageUrl, blobAuth);
    return { status: "deleted" };
  } catch (error) {
    console.warn("Product image cleanup failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return { status: "failed" };
  }
}

function getBlobOidcOptions(overrides?: BlobOidcOptions): BlobOidcOptions {
  const storeId = overrides?.storeId?.trim() || getBlobStoreEnv().BLOB_STORE_ID;
  const oidcToken = overrides?.oidcToken?.trim();

  return {
    ...(oidcToken ? { oidcToken } : {}),
    storeId
  };
}

function matchesImageSignature(type: string, bytes: Uint8Array) {
  if (type === "image/png") {
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte
    );
  }

  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (type === "image/webp") {
    return (
      textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 12) === "WEBP"
    );
  }

  return false;
}

function textAt(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

/**
 * True only for a Vercel Blob URL under this app's product-image prefix.
 * Relative paths (including the bundled placeholder) and any external host
 * fail the URL parse or the host check and are never deleted.
 */
export function isProductImageBlobUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const isBlobHost =
    url.hostname === "blob.vercel-storage.com" ||
    url.hostname.endsWith(".blob.vercel-storage.com");

  if (!isBlobHost) {
    return false;
  }

  return url.pathname
    .replace(/^\/+/, "")
    .startsWith(PRODUCT_IMAGE_BLOB_PREFIX);
}
