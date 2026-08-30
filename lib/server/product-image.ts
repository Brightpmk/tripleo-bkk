import "server-only";

import { del, put } from "@vercel/blob";
import type { DeleteCommandOptions, PutCommandOptions } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { getBlobStoreEnv } from "./env";
import { ProductAdminError } from "./product-admin-error";

export const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;

const extensionByType = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

type BlobOidcOptions = Pick<PutCommandOptions, "oidcToken" | "storeId">;

export async function validateProductImage(file: File) {
  const extension = extensionByType[file.type as keyof typeof extensionByType];

  if (!extension || file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ProductAdminError(
      "Upload a PNG, JPEG, or WEBP image up to 4 MB.",
      400,
      { image: "Upload a PNG, JPEG, or WEBP image up to 4 MB." }
    );
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (!matchesImageSignature(file.type, bytes)) {
    throw new ProductAdminError(
      "The selected file is not a valid product image.",
      400,
      { image: "The selected file is not a valid PNG, JPEG, or WEBP image." }
    );
  }

  return extension;
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
  const blob = await (options.putBlob ?? put)(pathname, file, {
    access: "public",
    addRandomSuffix: false,
    contentType: file.type,
    ...blobAuth
  });

  return blob.url;
}

export async function deleteProductImageBestEffort(
  imageUrl: string,
  options: { deleteBlob?: typeof del; blobAuth?: Pick<DeleteCommandOptions, "oidcToken" | "storeId"> } = {}
) {
  if (!isVercelBlobUrl(imageUrl)) return;

  try {
    const blobAuth = getBlobOidcOptions(options.blobAuth);
    await (options.deleteBlob ?? del)(imageUrl, blobAuth);
  } catch (error) {
    console.warn("Product image cleanup failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
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

function isVercelBlobUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "blob.vercel-storage.com" || hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
