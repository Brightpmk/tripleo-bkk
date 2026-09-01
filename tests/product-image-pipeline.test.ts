import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  optimizeProductImageForStorefront,
  STOREFRONT_IMAGE_MAX_EDGE_PX,
  STOREFRONT_IMAGE_TARGET_BYTES
} from "@/lib/server/product-image-pipeline";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-image-limits";

vi.mock("server-only", () => ({}));

/**
 * A real, decodable image. Smooth gradients stand in for product photography
 * (which compresses well); `noisy` produces an incompressible file for the
 * byte-limit cases.
 */
async function realImage(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp",
  options: { noisy?: boolean } = {}
) {
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;

      if (options.noisy) {
        pixels[offset] = Math.floor(Math.random() * 256);
        pixels[offset + 1] = Math.floor(Math.random() * 256);
        pixels[offset + 2] = Math.floor(Math.random() * 256);
      } else {
        // Soft gradient with gentle texture — photo-like entropy.
        pixels[offset] = (x * 255) / width;
        pixels[offset + 1] = (y * 255) / height;
        pixels[offset + 2] = ((x + y) * 127) / (width + height) + ((x * y) % 24);
      }
    }
  }

  const base = sharp(pixels, { raw: { width, height, channels: 3 } });
  const buffer =
    format === "jpeg"
      ? await base.jpeg({ quality: 92 }).toBuffer()
      : format === "png"
        ? await base.png().toBuffer()
        : await base.webp({ quality: 92 }).toBuffer();

  return new File([new Uint8Array(buffer)], `photo.${format}`, {
    type: `image/${format}`
  });
}

describe("storefront image optimisation", () => {
  it("resizes an oversized camera image down to the long-edge cap", async () => {
    const file = await realImage(4000, 3000, "jpeg");

    const result = await optimizeProductImageForStorefront(file);

    expect(result.sourceWidth).toBe(4000);
    expect(result.sourceHeight).toBe(3000);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
      STOREFRONT_IMAGE_MAX_EDGE_PX
    );
    expect(result.width).toBe(STOREFRONT_IMAGE_MAX_EDGE_PX);
  });

  it("preserves aspect ratio", async () => {
    const result = await optimizeProductImageForStorefront(
      await realImage(4000, 3000, "jpeg")
    );

    const sourceRatio = 4000 / 3000;
    const outputRatio = result.width / result.height;

    expect(Math.abs(outputRatio - sourceRatio)).toBeLessThan(0.01);
  });

  it("handles portrait orientation without cropping", async () => {
    const result = await optimizeProductImageForStorefront(
      await realImage(2000, 3000, "jpeg")
    );

    expect(result.height).toBe(STOREFRONT_IMAGE_MAX_EDGE_PX);
    expect(Math.abs(result.width / result.height - 2000 / 3000)).toBeLessThan(0.01);
  });

  it("never upscales a small image", async () => {
    const result = await optimizeProductImageForStorefront(
      await realImage(500, 400, "png")
    );

    expect(result.width).toBe(500);
    expect(result.height).toBe(400);
  });

  it("always outputs WebP", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const result = await optimizeProductImageForStorefront(
        await realImage(1800, 1200, format)
      );

      expect(result.contentType).toBe("image/webp");
      expect(result.extension).toBe("webp");
      // Verify the bytes really are WebP, not just labelled as such.
      expect(result.buffer.toString("ascii", 0, 4)).toBe("RIFF");
      expect(result.buffer.toString("ascii", 8, 12)).toBe("WEBP");
    }
  });

  it("produces a decodable image at the reported dimensions", async () => {
    const result = await optimizeProductImageForStorefront(
      await realImage(3000, 2000, "jpeg")
    );
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(result.width);
    expect(metadata.height).toBe(result.height);
  });

  it("keeps a realistic product photo comfortably under the soft ceiling", async () => {
    const result = await optimizeProductImageForStorefront(
      await realImage(2400, 1600, "jpeg")
    );

    expect(result.bytes).toBeLessThanOrEqual(STOREFRONT_IMAGE_TARGET_BYTES);
    // And meaningfully smaller than what was uploaded.
    expect(result.bytes).toBeLessThan(result.sourceBytes);
  });

  it("rejects a malformed file that claims to be an image", async () => {
    const file = new File([new TextEncoder().encode("definitely not an image")], "fake.png", {
      type: "image/png"
    });

    await expect(optimizeProductImageForStorefront(file)).rejects.toMatchObject({
      status: 400
    });
  });

  it("rejects a file with valid magic bytes but corrupt body", async () => {
    const corrupt = new Uint8Array(2048);
    corrupt.set([0xff, 0xd8, 0xff], 0);
    const file = new File([corrupt], "corrupt.jpg", { type: "image/jpeg" });

    await expect(optimizeProductImageForStorefront(file)).rejects.toMatchObject({
      status: 400
    });
  });

  it("rejects an unsupported type before doing any work", async () => {
    const file = new File([new Uint8Array(512)], "doc.pdf", {
      type: "application/pdf"
    });
    const transform = vi.fn();

    await expect(
      optimizeProductImageForStorefront(file, { transform: transform as never })
    ).rejects.toMatchObject({ status: 400 });
    expect(transform).not.toHaveBeenCalled();
  });

  it("rejects a payload beyond the upload cap before decoding", async () => {
    const oversized = new Uint8Array(MAX_PRODUCT_IMAGE_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff], 0);
    const file = new File([oversized], "huge.jpg", { type: "image/jpeg" });
    const transform = vi.fn();

    await expect(
      optimizeProductImageForStorefront(file, { transform: transform as never })
    ).rejects.toMatchObject({ status: 400 });
    expect(transform).not.toHaveBeenCalled();
  });

  it("accepts an image far above the old 4 MB limit", async () => {
    // Random pixels defeat PNG compression, landing between the old 4 MB
    // limit and the new cap.
    const file = await realImage(1196, 1196, "png", { noisy: true });

    expect(file.size).toBeGreaterThan(4 * 1024 * 1024);

    // Surviving optimisation proves it also passed the new upload cap.
    const result = await optimizeProductImageForStorefront(file);

    expect(result.bytes).toBeLessThan(file.size);
  });

  it("strips EXIF metadata from the stored image", async () => {
    const withExif = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 120, g: 80, b: 40 }
      }
    })
      .withExif({ IFD0: { Copyright: "SENSITIVE-CAMERA-OWNER" } })
      .jpeg()
      .toBuffer();

    const result = await optimizeProductImageForStorefront(
      new File([new Uint8Array(withExif)], "exif.jpg", { type: "image/jpeg" })
    );

    expect(result.buffer.toString("latin1")).not.toContain(
      "SENSITIVE-CAMERA-OWNER"
    );
  });
});
