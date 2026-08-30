/**
 * Client-side payment slip optimisation.
 *
 * A phone screenshot is typically 1–4 MB. On Thai mobile upstream that is
 * several seconds of the customer staring at a spinner, and it is by far the
 * largest term in submission latency. Downscaling to a legible-but-modest
 * JPEG usually cuts it by roughly an order of magnitude.
 *
 * This is a transport optimisation only. The server re-validates size, MIME
 * type and magic bytes on whatever actually arrives and remains the sole
 * authority — see lib/server/payment-slip-validation.ts. Every failure path
 * here falls back to the untouched original file.
 */

/** Long-edge cap. Slip amounts and reference numbers stay readable. */
export const SLIP_MAX_EDGE_PX = 1800;

/** JPEG quality. High enough for small Thai text on a banking slip. */
export const SLIP_JPEG_QUALITY = 0.85;

/** Below this, re-encoding costs quality and saves almost nothing. */
export const SLIP_COMPRESS_MIN_BYTES = 400 * 1024;

export type SlipOptimizeResult = {
  /** The file to upload — compressed, or the original when unchanged. */
  file: File;
  originalBytes: number;
  optimizedBytes: number;
  compressed: boolean;
};

export async function optimizeSlipImage(file: File): Promise<SlipOptimizeResult> {
  const untouched: SlipOptimizeResult = {
    file,
    originalBytes: file.size,
    optimizedBytes: file.size,
    compressed: false
  };

  if (
    typeof document === "undefined" ||
    file.size < SLIP_COMPRESS_MIN_BYTES ||
    !/^image\/(jpeg|png|webp)$/.test(file.type)
  ) {
    return untouched;
  }

  let source: Awaited<ReturnType<typeof loadImageSource>> | null = null;

  try {
    source = await loadImageSource(file);

    if (!source.width || !source.height) {
      return untouched;
    }

    const scale = Math.min(
      1,
      SLIP_MAX_EDGE_PX / Math.max(source.width, source.height)
    );
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      return untouched;
    }

    // JPEG has no alpha: matte transparent PNG screenshots onto white
    // instead of letting them flatten to black.
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.drawImage(source.image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", SLIP_JPEG_QUALITY);

    // Never upload something larger than what we started with.
    if (!blob || blob.size >= file.size) {
      return untouched;
    }

    return {
      file: new File([blob], toJpegName(file.name), {
        type: "image/jpeg",
        lastModified: Date.now()
      }),
      originalBytes: file.size,
      optimizedBytes: blob.size,
      compressed: true
    };
  } catch {
    // Any decode/encode problem: send the original and let the server judge.
    return untouched;
  } finally {
    source?.release();
  }
}

async function loadImageSource(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" honours EXIF rotation on photos of a screen.
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
      element.onerror = () => reject(new Error("Slip image could not be decoded."));
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

function toJpegName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").trim();

  return `${base || "payment-slip"}.jpg`;
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
