/**
 * Client-side product image optimisation.
 *
 * Vercel Functions hard-cap a request body at 4.5 MB (413
 * FUNCTION_PAYLOAD_TOO_LARGE), so a raw 50 MB camera file can never be POSTed
 * through the admin API. Instead the browser downscales and re-encodes it to
 * a web-appropriate size before upload, which both lifts the practical limit
 * for the admin and keeps the storefront fast on mobile.
 *
 * This is a transport and performance optimisation only. The server
 * re-validates size, MIME type and magic bytes on whatever actually arrives
 * and remains the sole authority — see lib/server/product-image.ts.
 */

/** What the admin may select. Anything larger is rejected up front. */
export const MAX_PRODUCT_IMAGE_SOURCE_BYTES = 50 * 1024 * 1024;

/** Long-edge cap. Generous for product photography on a storefront. */
export const PRODUCT_IMAGE_MAX_EDGE_PX = 2400;

export const acceptedProductImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

/**
 * Progressive passes. The first that lands under the byte budget wins, so a
 * normal photo keeps full quality and only genuinely huge files step down.
 */
const optimizePasses = [
  { maxEdge: PRODUCT_IMAGE_MAX_EDGE_PX, quality: 0.9 },
  { maxEdge: 2000, quality: 0.85 },
  { maxEdge: 1600, quality: 0.82 },
  { maxEdge: 1280, quality: 0.78 }
] as const;

export type ProductImageOptimizeResult =
  | {
      ok: true;
      file: File;
      originalBytes: number;
      optimizedBytes: number;
      optimized: boolean;
      width: number;
      height: number;
    }
  | { ok: false; message: string };

export function resolveProductImageMimeType(type: string, name = ""): string {
  const normalized = (type || "").toLowerCase().trim();
  if ((acceptedProductImageTypes as readonly string[]).includes(normalized)) {
    return normalized;
  }

  const lowerName = name.toLowerCase().trim();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".png")) {
    return "image/png";
  }
  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }

  return normalized;
}

export function isAcceptedProductImageType(type: string, name = "") {
  const resolved = resolveProductImageMimeType(type, name);
  return (acceptedProductImageTypes as readonly string[]).includes(resolved);
}

export async function optimizeProductImage(
  file: File,
  targetBytes: number
): Promise<ProductImageOptimizeResult> {
  const resolvedType = resolveProductImageMimeType(file.type, file.name);
  if (!isAcceptedProductImageType(resolvedType)) {
    return { ok: false, message: "Choose a PNG, JPEG, or WEBP image." };
  }

  if (file.size <= 0) {
    return { ok: false, message: "That image file is empty." };
  }

  if (file.size > MAX_PRODUCT_IMAGE_SOURCE_BYTES) {
    return {
      ok: false,
      message: `Images must be ${formatBytes(MAX_PRODUCT_IMAGE_SOURCE_BYTES)} or smaller.`
    };
  }

  if (typeof document === "undefined") {
    return passthrough(file);
  }

  let source: Awaited<ReturnType<typeof loadImageSource>> | null = null;

  try {
    source = await loadImageSource(file);

    if (!source.width || !source.height) {
      return passthrough(file);
    }

    // Already small enough (<= 800 KB) and modestly sized: leave untouched
    // rather than re-encoding and losing quality for no benefit.
    const ALREADY_OPTIMIZED_THRESHOLD_BYTES = 800 * 1024;
    if (
      file.size <= Math.min(targetBytes, ALREADY_OPTIMIZED_THRESHOLD_BYTES) &&
      Math.max(source.width, source.height) <= PRODUCT_IMAGE_MAX_EDGE_PX
    ) {
      return {
        ok: true,
        file,
        originalBytes: file.size,
        optimizedBytes: file.size,
        optimized: false,
        width: source.width,
        height: source.height
      };
    }

    // PNG keeps alpha by re-encoding to WEBP; everything else goes to JPEG.
    const preferredType = resolvedType === "image/png" ? "image/webp" : "image/jpeg";
    let best: { blob: Blob; width: number; height: number } | null = null;

    for (const pass of optimizePasses) {
      const encoded = await encode(source, pass.maxEdge, preferredType, pass.quality);

      if (!encoded) {
        continue;
      }

      best = encoded;

      if (encoded.blob.size <= targetBytes) {
        break;
      }
    }

    if (!best) {
      return passthrough(file);
    }

    if (best.blob.size > targetBytes) {
      return {
        ok: false,
        message:
          "This image is too detailed to compress for upload. Please resize it and try again."
      };
    }

    // A re-encode that grew the file is not an optimisation.
    if (best.blob.size >= file.size && file.size <= targetBytes) {
      return passthrough(file);
    }

    return {
      ok: true,
      file: new File([best.blob], renameFor(file.name, best.blob.type), {
        type: best.blob.type,
        lastModified: Date.now()
      }),
      originalBytes: file.size,
      optimizedBytes: best.blob.size,
      optimized: true,
      width: best.width,
      height: best.height
    };
  } catch {
    return passthrough(file);
  } finally {
    source?.release();
  }
}

function passthrough(file: File): ProductImageOptimizeResult {
  return {
    ok: true,
    file,
    originalBytes: file.size,
    optimizedBytes: file.size,
    optimized: false,
    width: 0,
    height: 0
  };
}

async function encode(
  source: { image: CanvasImageSource; width: number; height: number },
  maxEdge: number,
  type: string,
  quality: number
) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  // JPEG has no alpha: matte onto white so transparency never turns black.
  if (type === "image/jpeg") {
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
  }

  try {
    context.drawImage(source.image, 0, 0, width, height);
  } catch {
    return null;
  }

  const blob = await canvasToBlob(canvas, type, quality);

  if (!blob) {
    return null;
  }

  // Some browsers silently fall back to PNG when asked for an unsupported
  // type. Only accept a blob the server will actually recognise.
  if (!isAcceptedProductImageType(blob.type)) {
    return null;
  }

  return { blob, width, height };
}

async function loadImageSource(file: File) {
  // On iOS / iPadOS Safari, createImageBitmap has known WebKit bugs (e.g. throwing
  // InvalidStateError on 2D canvas drawImage or memory allocation limits).
  // Using HTMLImageElement via object URL is universally reliable across WebKit and iPad.
  const isSafariOrIOS =
    typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent));

  if (!isSafariOrIOS && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image"
      });

      return {
        image: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close()
      };
    } catch {
      // Older Safari rejects the options bag — fall through to <img>.
    }
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image could not be decoded."));
      element.src = objectUrl;
    });

    return {
      image: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl)
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function renameFor(name: string, type: string) {
  const base = name.replace(/\.[^.]+$/, "").trim() || "product-image";
  const extension = type === "image/webp" ? "webp" : "jpg";

  return `${base}.${extension}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
