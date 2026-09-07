import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSlipBlobPath
} from "@/lib/server/payment-slip-storage";
import { validatePaymentSlipUpload } from "@/lib/server/payment-slip-validation";

vi.mock("server-only", () => ({}));

let jpegBytes: ArrayBuffer;
let pngBytes: ArrayBuffer;
let webpBytes: ArrayBuffer;

beforeAll(async () => {
  const image = sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" }
  });
  jpegBytes = Uint8Array.from(await image.clone().jpeg().toBuffer()).buffer;
  pngBytes = Uint8Array.from(await image.clone().png().toBuffer()).buffer;
  webpBytes = Uint8Array.from(await image.clone().webp().toBuffer()).buffer;
});

describe("payment slip validation", () => {
  it("accepts a supported JPEG", async () => {
    const result = await validatePaymentSlipUpload(
      new File([jpegBytes], "slip.jpg", { type: "image/jpeg" })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.slip.extension : undefined).toBe("jpg");
  });

  it("accepts a supported PNG", async () => {
    const result = await validatePaymentSlipUpload(
      new File([pngBytes], "slip.png", { type: "image/png" })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.slip.extension : undefined).toBe("png");
  });

  it("accepts a supported WEBP", async () => {
    const result = await validatePaymentSlipUpload(
      new File([webpBytes], "slip.webp", { type: "image/webp" })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.slip.extension : undefined).toBe("webp");
  });

  it("rejects an unsupported file type", async () => {
    const result = await validatePaymentSlipUpload(
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "slip.pdf", {
        type: "application/pdf"
      })
    );

    expect(result.ok).toBe(false);
  });

  it("rejects malformed content even when its signature looks valid", async () => {
    const result = await validatePaymentSlipUpload(
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "broken.jpg", {
        type: "image/jpeg"
      })
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an oversized file", async () => {
    const result = await validatePaymentSlipUpload(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", {
        type: "image/jpeg"
      })
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a missing slip", async () => {
    const result = await validatePaymentSlipUpload(null);

    expect(result.ok).toBe(false);
  });

  it("generates non-guessable Blob paths without customer PII", () => {
    const pathname = buildSlipBlobPath(
      "KG-2026-A8F2B91C",
      "jpg",
      "123e4567-e89b-42d3-a456-426614174000"
    );

    expect(pathname).toBe(
      "payment-slips/KG-2026-A8F2B91C/123e4567-e89b-42d3-a456-426614174000.jpg"
    );
    expect(pathname).not.toContain("Ada");
    expect(pathname).not.toContain("0812345678");
    expect(pathname).not.toContain("Test Road");
  });
});
