import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  addProductImages,
  removeProductImage,
  reorderProductImages,
  type ProductImageOperationDependencies
} from "@/lib/server/product-image-operations";
import type { ProductImageRow } from "@/lib/server/supabase/product-image-repository";
import { deleteAdminProductWithImageCleanup } from "@/lib/server/product-admin-operations";
import type { AdminProduct } from "@/lib/admin-products";
import { POST as postImages, DELETE as deleteImage, PATCH as patchImages } from "@/app/api/admin/products/[productId]/images/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

const PRODUCT_ID = "kg-bm-aurora";
const BLOB = "https://store.public.blob.vercel-storage.com/products";

function imageRow(url: string, sortOrder: number): ProductImageRow {
  return { id: `id-${sortOrder}`, productId: PRODUCT_ID, imageUrl: url, sortOrder };
}

async function realImage(width = 1200, height = 900) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 140, b: 200 } }
  })
    .jpeg()
    .toBuffer();

  return new File([new Uint8Array(buffer)], "photo.jpg", { type: "image/jpeg" });
}

function deps(
  overrides: Partial<ProductImageOperationDependencies> = {}
): ProductImageOperationDependencies {
  return {
    optimize: vi.fn(async () => ({
      buffer: Buffer.from("optimised"),
      contentType: "image/webp" as const,
      extension: "webp" as const,
      width: 1600,
      height: 1200,
      bytes: 400_000,
      sourceBytes: 4_000_000,
      sourceWidth: 4000,
      sourceHeight: 3000
    })),
    uploadBlob: vi.fn(async () => `${BLOB}/${PRODUCT_ID}/new.webp`),
    addImage: vi.fn(async () => undefined),
    removeImage: vi.fn(async () => undefined),
    listImages: vi.fn(async () => [imageRow(`${BLOB}/${PRODUCT_ID}/new.webp`, 1)]),
    reorderImages: vi.fn(async () => undefined),
    deleteBlob: vi.fn(async () => ({ status: "deleted" as const })),
    invalidateCatalog: vi.fn(),
    ...overrides
  };
}

/* ── Upload ─────────────────────────────────────────────────────── */

describe("multi-image upload", () => {
  it("uploads several files in one call", async () => {
    const dependencies = deps();
    const files = [await realImage(), await realImage(), await realImage()];

    const result = await addProductImages(PRODUCT_ID, files, dependencies);

    expect(result.uploaded).toHaveLength(3);
    expect(result.uploaded.every((entry) => entry.ok)).toBe(true);
    expect(dependencies.addImage).toHaveBeenCalledTimes(3);
  });

  it("optimises before uploading and stores only the optimised bytes", async () => {
    const uploadBlob = vi.fn(async () => `${BLOB}/${PRODUCT_ID}/a.webp`);
    const dependencies = deps({ uploadBlob });

    await addProductImages(PRODUCT_ID, [await realImage()], dependencies);

    expect(dependencies.optimize).toHaveBeenCalledTimes(1);
    expect(uploadBlob).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/webp", extension: "webp" })
    );
  });

  it("lets one bad file fail without losing the others", async () => {
    const optimize = vi
      .fn()
      .mockResolvedValueOnce({
        buffer: Buffer.from("ok"),
        contentType: "image/webp",
        extension: "webp",
        width: 1600,
        height: 1200,
        bytes: 1,
        sourceBytes: 2,
        sourceWidth: 3,
        sourceHeight: 4
      })
      .mockRejectedValueOnce(new Error("corrupt"))
      .mockResolvedValueOnce({
        buffer: Buffer.from("ok"),
        contentType: "image/webp",
        extension: "webp",
        width: 1600,
        height: 1200,
        bytes: 1,
        sourceBytes: 2,
        sourceWidth: 3,
        sourceHeight: 4
      });
    const dependencies = deps({ optimize: optimize as never });

    const result = await addProductImages(
      PRODUCT_ID,
      [await realImage(), await realImage(), await realImage()],
      dependencies
    );

    expect(result.uploaded.filter((entry) => entry.ok)).toHaveLength(2);
    expect(result.uploaded.filter((entry) => !entry.ok)).toHaveLength(1);
    // The two good files still made it into the gallery.
    expect(dependencies.addImage).toHaveBeenCalledTimes(2);
  });

  it("deletes the orphaned Blob when the database row fails", async () => {
    const deleteBlob = vi.fn(async () => ({ status: "deleted" as const }));
    const dependencies = deps({
      addImage: vi.fn(async () => {
        throw new Error("insert failed");
      }),
      deleteBlob
    });

    const result = await addProductImages(
      PRODUCT_ID,
      [await realImage()],
      dependencies
    );

    expect(result.uploaded[0].ok).toBe(false);
    // No row points at it, so the Blob must not be left behind.
    expect(deleteBlob).toHaveBeenCalledWith(`${BLOB}/${PRODUCT_ID}/new.webp`);
  });

  it("rejects an empty upload", async () => {
    await expect(
      addProductImages(PRODUCT_ID, [], deps())
    ).rejects.toMatchObject({ status: 400 });
  });

  it("never exposes provider internals in a failure message", async () => {
    const dependencies = deps({
      uploadBlob: vi.fn(async () => {
        throw new Error("BlobError: token sk_live_secret rejected");
      })
    });

    const result = await addProductImages(
      PRODUCT_ID,
      [await realImage()],
      dependencies
    );

    expect(result.uploaded[0].ok).toBe(false);
    expect(JSON.stringify(result.uploaded)).not.toContain("sk_live_secret");
  });
});

/* ── Delete ─────────────────────────────────────────────────────── */

describe("deleting one image", () => {
  it("removes the row then best-effort deletes the Blob", async () => {
    const order: string[] = [];
    const dependencies = deps({
      removeImage: vi.fn(async () => {
        order.push("row");
      }),
      deleteBlob: vi.fn(async () => {
        order.push("blob");
        return { status: "deleted" as const };
      })
    });

    await removeProductImage(PRODUCT_ID, `${BLOB}/a.webp`, dependencies);

    // Row first: a Blob failure then leaves the gallery correct.
    expect(order).toEqual(["row", "blob"]);
  });

  it("still succeeds when Blob cleanup fails", async () => {
    const dependencies = deps({
      deleteBlob: vi.fn(async () => ({ status: "failed" as const }))
    });

    const result = await removeProductImage(
      PRODUCT_ID,
      `${BLOB}/a.webp`,
      dependencies
    );

    expect(result.imageCleanup).toBe("failed");
    expect(dependencies.removeImage).toHaveBeenCalled();
  });

  it("rejects a blank image URL", async () => {
    await expect(
      removeProductImage(PRODUCT_ID, "  ", deps())
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* ── Reorder ────────────────────────────────────────────────────── */

describe("reordering", () => {
  it("changes the primary image by moving a URL first", async () => {
    const reorderImages = vi.fn(async () => undefined);
    const dependencies = deps({
      listImages: vi.fn(async () => [
        imageRow(`${BLOB}/a.webp`, 1),
        imageRow(`${BLOB}/b.webp`, 2)
      ]),
      reorderImages
    });

    await reorderProductImages(
      PRODUCT_ID,
      [`${BLOB}/b.webp`, `${BLOB}/a.webp`],
      dependencies
    );

    expect(reorderImages).toHaveBeenCalledWith(PRODUCT_ID, [
      `${BLOB}/b.webp`,
      `${BLOB}/a.webp`
    ]);
  });

  it("refuses an order that does not match the product's images", async () => {
    const dependencies = deps({
      listImages: vi.fn(async () => [
        imageRow(`${BLOB}/a.webp`, 1),
        imageRow(`${BLOB}/b.webp`, 2)
      ])
    });

    await expect(
      reorderProductImages(PRODUCT_ID, [`${BLOB}/a.webp`], dependencies)
    ).rejects.toMatchObject({ status: 400 });
    expect(dependencies.reorderImages).not.toHaveBeenCalled();
  });

  it("ignores an unknown URL smuggled into the order", async () => {
    const dependencies = deps({
      listImages: vi.fn(async () => [imageRow(`${BLOB}/a.webp`, 1)])
    });

    await expect(
      reorderProductImages(
        PRODUCT_ID,
        [`${BLOB}/a.webp`, "https://evil.test/x.webp"],
        dependencies
      )
    ).resolves.toBeDefined();
    expect(dependencies.reorderImages).toHaveBeenCalledWith(PRODUCT_ID, [
      `${BLOB}/a.webp`
    ]);
  });
});

/* ── Product deletion cleans the whole gallery ──────────────────── */

describe("product deletion with a gallery", () => {
  const product: AdminProduct = {
    productId: PRODUCT_ID,
    university: "BANGMOD",
    shirtColor: "Aurora Glow",
    priceThb: 450,
    imageUrl: `${BLOB}/a.webp`,
    availableSizes: ["M"],
    active: true,
    sortOrder: 1
  };

  function productDeps(overrides: Record<string, unknown> = {}) {
    return {
      listProducts: vi.fn(async () => [product]),
      createProduct: vi.fn(),
      updateProduct: vi.fn(),
      deleteProduct: vi.fn(async () => undefined),
      listImageUrls: vi.fn(async () => [
        `${BLOB}/a.webp`,
        `${BLOB}/b.webp`,
        `${BLOB}/c.webp`
      ]),
      uploadImage: vi.fn(),
      deleteImage: vi.fn(async () => ({ status: "deleted" as const })),
      invalidateCatalog: vi.fn(),
      ...overrides
    } as never;
  }

  it("cleans up every gallery Blob, not just the cover", async () => {
    const deleteImage = vi.fn(async () => ({ status: "deleted" as const }));
    const result = await deleteAdminProductWithImageCleanup(
      PRODUCT_ID,
      productDeps({ deleteImage })
    );

    expect(deleteImage).toHaveBeenCalledTimes(3);
    expect(result.imageCleanupCount).toBe(3);
    expect(result.imageCleanup).toBe("deleted");
  });

  it("collects image URLs before deleting the product row", async () => {
    const order: string[] = [];
    await deleteAdminProductWithImageCleanup(
      PRODUCT_ID,
      productDeps({
        listImageUrls: vi.fn(async () => {
          order.push("list");
          return [`${BLOB}/a.webp`];
        }),
        deleteProduct: vi.fn(async () => {
          order.push("delete");
        })
      })
    );

    expect(order).toEqual(["list", "delete"]);
  });

  it("reports a partial Blob cleanup failure without failing the delete", async () => {
    const result = await deleteAdminProductWithImageCleanup(
      PRODUCT_ID,
      productDeps({
        deleteImage: vi
          .fn()
          .mockResolvedValueOnce({ status: "deleted" })
          .mockResolvedValueOnce({ status: "failed" })
          .mockResolvedValueOnce({ status: "deleted" })
      })
    );

    expect(result.product.productId).toBe(PRODUCT_ID);
    expect(result.imageCleanup).toBe("failed");
  });

  it("falls back to the cover image when the gallery read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deleteImage = vi.fn(async () => ({ status: "deleted" as const }));

    await deleteAdminProductWithImageCleanup(
      PRODUCT_ID,
      productDeps({
        listImageUrls: vi.fn(async () => {
          throw new Error("db down");
        }),
        deleteImage
      })
    );

    expect(deleteImage).toHaveBeenCalledWith(`${BLOB}/a.webp`);
    warn.mockRestore();
  });

  it("never deletes a Blob when the product row delete fails", async () => {
    const deleteImage = vi.fn();

    await expect(
      deleteAdminProductWithImageCleanup(
        PRODUCT_ID,
        productDeps({
          deleteProduct: vi.fn(async () => {
            throw new Error("db down");
          }),
          deleteImage
        })
      )
    ).rejects.toThrow("db down");

    expect(deleteImage).not.toHaveBeenCalled();
  });
});

/* ── Endpoint security ──────────────────────────────────────────── */

describe("image endpoint security", () => {
  const params = { params: Promise.resolve({ productId: PRODUCT_ID }) };

  function request(method: string, body?: unknown) {
    return new Request(
      `https://shop.example/api/admin/products/${PRODUCT_ID}/images`,
      {
        method,
        headers: {
          origin: "https://shop.example",
          "content-type": "application/json"
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }
    );
  }

  it("rejects unauthenticated uploads", async () => {
    expect((await postImages(request("POST"), params)).status).toBe(401);
  });

  it("rejects unauthenticated deletes", async () => {
    expect(
      (await deleteImage(request("DELETE", { imageUrl: "x" }), params)).status
    ).toBe(401);
  });

  it("rejects unauthenticated reorders", async () => {
    expect(
      (await patchImages(request("PATCH", { imageUrls: [] }), params)).status
    ).toBe(401);
  });
});
