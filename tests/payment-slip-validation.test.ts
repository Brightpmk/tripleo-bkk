import { describe, expect, it, vi } from "vitest";
import {
  buildSlipFileName,
  type PaymentSlipUploadInput
} from "@/lib/server/payment-slip-storage";
import { validatePaymentSlipUpload } from "@/lib/server/payment-slip-validation";

vi.mock("server-only", () => ({}));

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
]);

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

  it("generates filenames without customer PII", () => {
    const input: PaymentSlipUploadInput = {
      orderId: "KG-2026-A8F2B91C",
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
      buffer: Buffer.from(jpegBytes),
      mimeType: "image/jpeg",
      extension: "jpg"
    };
    const fileName = buildSlipFileName(input);

    expect(fileName).toMatch(/^KG-2026-A8F2B91C-20260829-[a-f0-9]{6}\.jpg$/);
    expect(fileName).not.toContain("Ada");
    expect(fileName).not.toContain("0812345678");
    expect(fileName).not.toContain("Test Road");
  });
});
