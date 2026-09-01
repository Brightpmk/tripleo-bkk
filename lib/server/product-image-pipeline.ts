import "server-only";

import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import { ProductAdminError } from "./product-admin-error";
import { validateProductImage } from "./product-image";

/**
 * Canonical storefront image optimisation.
 *
 * Stage two of a two-stage pipeline. The browser downscales the admin's pick
 * (up to 50 MB) to something that fits Vercel's 4.5 MB request-body cap; this
 * module then produces the authoritative storefront asset — the browser's
 * output is never trusted as final.
 *
 * Output: WebP, long edge capped, quality tuned so a typical product photo
 * lands around 300–700 KB. Small images are never upscaled.
 */

/** Long edge cap for the stored storefront image. */
export const STOREFRONT_IMAGE_MAX_EDGE_PX = 1600;

/** Starting WebP quality. Stepped down only if the result is oversized. */
export const STOREFRONT_IMAGE_QUALITY = 82;

/** Soft ceiling. Complex images may exceed it after the last quality step. */
export const STOREFRONT_IMAGE_TARGET_BYTES = 1_000_000;

const qualitySteps = [STOREFRONT_IMAGE_QUALITY, 74, 66] as const;

export type OptimizedProductImage = {
  buffer: Buffer;
  contentType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  bytes: number;
  sourceBytes: number;
  sourceWidth: number;
  sourceHeight: number;
};

/**
 * Validates the uploaded file, then re-encodes it for the storefront.
 *
 * Validation runs first and unchanged: MIME allowlist, byte cap, and magic
 * byte check. A file that survives that but cannot be decoded by sharp is a
 * malformed image and is rejected rather than stored.
 */
export async function optimizeProductImageForStorefront(
  file: File,
  options: { transform?: typeof sharp } = {}
): Promise<OptimizedProductImage> {
  await validateProductImage(file);

  const sourceBytes = file.size;
  const input = Buffer.from(await file.arrayBuffer());
  const transform = options.transform ?? sharp;

  let metadata: Metadata;

  try {
    metadata = await transform(input).metadata();
  } catch {
    throw imageError("That image could not be read. Please try another file.");
  }

  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    throw imageError("That image could not be read. Please try another file.");
  }

  let best: { buffer: Buffer; width: number; height: number } | null = null;

  for (const quality of qualitySteps) {
    let encoded: { data: Buffer; info: OutputInfo };

    try {
      encoded = await transform(input)
        // Strips EXIF/GPS as a side effect; rotate() first so orientation
        // is baked in rather than lost with the metadata.
        .rotate()
        .resize({
          width: STOREFRONT_IMAGE_MAX_EDGE_PX,
          height: STOREFRONT_IMAGE_MAX_EDGE_PX,
          fit: "inside",
          // Never upscale: a 600px source stays 600px.
          withoutEnlargement: true
        })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw imageError(
        "That image could not be processed. Please try another file."
      );
    }

    best = {
      buffer: encoded.data,
      width: encoded.info.width,
      height: encoded.info.height
    };

    if (encoded.data.byteLength <= STOREFRONT_IMAGE_TARGET_BYTES) {
      break;
    }
  }

  if (!best) {
    throw imageError(
      "That image could not be processed. Please try another file."
    );
  }

  return {
    buffer: best.buffer,
    contentType: "image/webp",
    extension: "webp",
    width: best.width,
    height: best.height,
    bytes: best.buffer.byteLength,
    sourceBytes,
    sourceWidth,
    sourceHeight
  };
}

function imageError(message: string) {
  return new ProductAdminError(message, 400, { image: message });
}
