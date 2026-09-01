import { describe, expect, it, vi } from "vitest";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  VERCEL_REQUEST_BODY_LIMIT_BYTES
} from "@/lib/product-image-limits";
import {
  MAX_PRODUCT_IMAGE_SOURCE_BYTES,
  isAcceptedProductImageType,
  optimizeProductImage
} from "@/lib/product-image-client";
import {
  deleteProductImageBestEffort,
  uploadProductImage,
  validateProductImage
} from "@/lib/server/product-image";

vi.mock("server-only", () => ({}));

const OLD_LIMIT_BYTES = 4 * 1024 * 1024;

/** Valid magic bytes padded out to an arbitrary size. */
function imageFile(
  type: "image/jpeg" | "image/png" | "image/webp",
  bytes: number,
  name = "photo"
) {
  const buffer = new Uint8Array(Math.max(bytes, 16));

  if (type === "image/jpeg") {
    buffer.set([0xff, 0xd8, 0xff], 0);
  } else if (type === "image/png") {
    buffer.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  } else {
    buffer.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    buffer.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  }

  return new File([buffer], `${name}.bin`, { type });
}

/* ── Limits ─────────────────────────────────────────────────────── */

describe("product image limits", () => {
  it("accepts more than the old 4 MB limit", async () => {
    const file = imageFile("image/jpeg", OLD_LIMIT_BYTES + 1);

    expect(file.size).toBeGreaterThan(OLD_LIMIT_BYTES);
    await expect(validateProductImage(file)).resolves.toBe("jpg");
  });

  it("keeps the server cap under Vercel's platform body limit", () => {
    expect(MAX_PRODUCT_IMAGE_BYTES).toBeGreaterThan(OLD_LIMIT_BYTES);
    expect(MAX_PRODUCT_IMAGE_BYTES).toBeLessThan(VERCEL_REQUEST_BODY_LIMIT_BYTES);
  });

  it("lets the admin select a source image far above the upload cap", () => {
    expect(MAX_PRODUCT_IMAGE_SOURCE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_PRODUCT_IMAGE_SOURCE_BYTES).toBeGreaterThan(MAX_PRODUCT_IMAGE_BYTES);
  });

  it("rejects a payload beyond the new practical maximum", async () => {
    const file = imageFile("image/jpeg", MAX_PRODUCT_IMAGE_BYTES + 1);

    await expect(validateProductImage(file)).rejects.toMatchObject({
      status: 400
    });
  });
});

/* ── Server-side validation stays strict ────────────────────────── */

describe("server-side image validation", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"]
  ] as const)("accepts a valid %s", async (type, extension) => {
    await expect(validateProductImage(imageFile(type, 2048))).resolves.toBe(
      extension
    );
  });

  it("rejects an unsupported type", async () => {
    const file = new File([new Uint8Array(1024)], "doc.pdf", {
      type: "application/pdf"
    });

    await expect(validateProductImage(file)).rejects.toMatchObject({
      status: 400
    });
  });

  it("rejects a malformed file whose MIME type lies", async () => {
    const file = new File([new TextEncoder().encode("not an image at all")], "fake.png", {
      type: "image/png"
    });

    await expect(validateProductImage(file)).rejects.toMatchObject({
      status: 400
    });
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });

    await expect(validateProductImage(file)).rejects.toMatchObject({
      status: 400
    });
  });

  it("still validates content before uploading a large image", async () => {
    const putBlob = vi.fn();
    const file = new File([new Uint8Array(OLD_LIMIT_BYTES + 1)], "big.jpg", {
      type: "image/jpeg"
    });

    await expect(
      uploadProductImage("kg-bm-aurora", file, { putBlob: putBlob as never })
    ).rejects.toMatchObject({ status: 400 });
    expect(putBlob).not.toHaveBeenCalled();
  });
});

/* ── Upload path ────────────────────────────────────────────────── */

describe("large image upload", () => {
  it("uploads a >4 MB image with OIDC options and no read/write token", async () => {
    const putBlob = vi.fn(
      async (_pathname: string, _body: File, _options: unknown) => ({
        url: "https://store.public.blob.vercel-storage.com/products/kg/large.jpg"
      })
    );

    const url = await uploadProductImage(
      "kg-bm-aurora",
      imageFile("image/jpeg", OLD_LIMIT_BYTES + 1),
      {
        putBlob: putBlob as never,
        blobAuth: { oidcToken: "test-oidc-token", storeId: "store_test" },
        now: () => 1234,
        randomId: () => "safe-random-id"
      }
    );

    expect(url).toContain("blob.vercel-storage.com");
    expect(putBlob).toHaveBeenCalledWith(
      "products/kg-bm-aurora/1234-safe-random-id.jpg",
      expect.anything(),
      expect.objectContaining({
        access: "public",
        oidcToken: "test-oidc-token",
        storeId: "store_test"
      })
    );
    expect(putBlob.mock.calls[0][2]).not.toHaveProperty("token");
  });

  it("returns a clean admin error when the Blob API fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const putBlob = vi.fn(async () => {
      throw new Error("BlobServiceNotAvailable: token abc123 rejected");
    });

    let failure: { status?: number; message?: string } = {};

    try {
      await uploadProductImage("kg-bm-aurora", imageFile("image/png", 2048), {
        putBlob: putBlob as never,
        blobAuth: { storeId: "store_test" }
      });
    } catch (thrown) {
      failure = thrown as { status?: number; message?: string };
    }

    expect(failure.status).toBe(502);
    // No credentials or provider internals in the admin-visible message.
    expect(failure.message).not.toContain("abc123");
    expect(failure.message).not.toContain("BlobServiceNotAvailable");
    expect(JSON.stringify(error.mock.calls)).not.toContain("abc123");
    error.mockRestore();
  });
});

/* ── Cleanup unchanged ──────────────────────────────────────────── */

describe("blob cleanup still works", () => {
  it("deletes a product image with OIDC options", async () => {
    const deleteBlob = vi.fn(async (_url: string, _options: unknown) => undefined);
    const url = "https://store.public.blob.vercel-storage.com/products/old.png";

    const result = await deleteProductImageBestEffort(url, {
      deleteBlob: deleteBlob as never,
      blobAuth: { oidcToken: "test-oidc-token", storeId: "store_test" }
    });

    expect(result).toEqual({ status: "deleted" });
    expect(deleteBlob).toHaveBeenCalledWith(url, {
      oidcToken: "test-oidc-token",
      storeId: "store_test"
    });
    expect(deleteBlob.mock.calls[0][1]).not.toHaveProperty("token");
  });

  it("still skips external and placeholder URLs", async () => {
    const deleteBlob = vi.fn();

    for (const value of [
      "",
      "/products/product-placeholder.svg",
      "https://images.example.com/products/shirt.png"
    ]) {
      const result = await deleteProductImageBestEffort(value, {
        deleteBlob: deleteBlob as never
      });
      expect(result.status).toBe("skipped");
    }

    expect(deleteBlob).not.toHaveBeenCalled();
  });
});

/* ── Client-side optimisation guards ────────────────────────────── */

describe("client-side optimisation", () => {
  it("recognises exactly the supported types", () => {
    expect(isAcceptedProductImageType("image/jpeg")).toBe(true);
    expect(isAcceptedProductImageType("image/png")).toBe(true);
    expect(isAcceptedProductImageType("image/webp")).toBe(true);
    expect(isAcceptedProductImageType("image/gif")).toBe(false);
    expect(isAcceptedProductImageType("application/pdf")).toBe(false);
  });

  it("rejects an unsupported type before any work", async () => {
    const file = new File([new Uint8Array(1024)], "doc.pdf", {
      type: "application/pdf"
    });

    const result = await optimizeProductImage(file, MAX_PRODUCT_IMAGE_BYTES);

    expect(result.ok).toBe(false);
  });

  it("rejects a source beyond the 50 MB maximum", async () => {
    const file = imageFile("image/jpeg", MAX_PRODUCT_IMAGE_SOURCE_BYTES + 1);

    const result = await optimizeProductImage(file, MAX_PRODUCT_IMAGE_BYTES);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("50.0 MB");
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });

    expect((await optimizeProductImage(file, MAX_PRODUCT_IMAGE_BYTES)).ok).toBe(
      false
    );
  });

  it("passes the original through when no DOM is available", async () => {
    const file = imageFile("image/jpeg", 2048);
    const result = await optimizeProductImage(file, MAX_PRODUCT_IMAGE_BYTES);

    expect(result.ok).toBe(true);
    expect(result.ok && result.file).toBe(file);
    expect(result.ok && result.optimized).toBe(false);
  });
});
