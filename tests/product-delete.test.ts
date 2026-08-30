import { describe, expect, it, vi } from "vitest";
import type { AdminProduct } from "@/lib/admin-products";
import { productImagePlaceholder } from "@/lib/catalog";
import { deleteAdminProductWithImageCleanup } from "@/lib/server/product-admin-operations";
import {
  deleteProductImageBestEffort,
  isProductImageBlobUrl
} from "@/lib/server/product-image";
import { deleteProductRowWithClient } from "@/lib/server/google-sheets";
import { mapOrderToSheetRows } from "@/lib/server/order-row-mapper";
import type { ConfirmedOrder } from "@/lib/orders";
import { DELETE as deleteProductRequest } from "@/app/api/admin/products/[productId]/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

const blobImageUrl =
  "https://store.public.blob.vercel-storage.com/products/kg-bm-aurora/1-a.png";

const product: AdminProduct = {
  productId: "kg-bm-aurora",
  university: "BANGMOD",
  shirtColor: "Aurora Glow",
  priceThb: 450,
  imageUrl: blobImageUrl,
  availableSizes: ["S", "M", "XL"],
  active: true,
  sortOrder: 4
};

function makeDependencies(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listProducts: vi.fn(async () => [product]),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(async () => undefined),
    uploadImage: vi.fn(),
    deleteImage: vi.fn(async () => ({ status: "deleted" as const })),
    invalidateCatalog: vi.fn(),
    ...overrides
  } as never;
}

describe("permanent product deletion", () => {
  it("deletes the product row, then its Blob image, then invalidates cache", async () => {
    const order: string[] = [];
    const deleteProduct = vi.fn(async () => {
      order.push("sheet");
    });
    const deleteImage = vi.fn(async () => {
      order.push("blob");
      return { status: "deleted" as const };
    });
    const invalidateCatalog = vi.fn(() => {
      order.push("cache");
    });

    const result = await deleteAdminProductWithImageCleanup(
      product.productId,
      makeDependencies({ deleteProduct, deleteImage, invalidateCatalog })
    );

    expect(deleteProduct).toHaveBeenCalledWith(product.productId);
    expect(deleteImage).toHaveBeenCalledWith(blobImageUrl);
    // Sheet is the source of truth and must commit before anything else.
    expect(order).toEqual(["sheet", "blob", "cache"]);
    expect(result.product.productId).toBe(product.productId);
    expect(result.imageCleanup).toBe("deleted");
  });

  it("invalidates the storefront catalog cache exactly once", async () => {
    const invalidateCatalog = vi.fn();

    await deleteAdminProductWithImageCleanup(
      product.productId,
      makeDependencies({ invalidateCatalog })
    );

    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it("rejects a PRODUCT_ID that is not in the catalog without deleting anything", async () => {
    const deleteProduct = vi.fn();
    const deleteImage = vi.fn();

    await expect(
      deleteAdminProductWithImageCleanup(
        "does-not-exist",
        makeDependencies({ deleteProduct, deleteImage })
      )
    ).rejects.toMatchObject({ status: 404 });

    expect(deleteProduct).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("never touches the Blob image when the Sheet deletion fails", async () => {
    const deleteProduct = vi.fn(async () => {
      throw new Error("Google Sheets unavailable");
    });
    const deleteImage = vi.fn();
    const invalidateCatalog = vi.fn();

    await expect(
      deleteAdminProductWithImageCleanup(
        product.productId,
        makeDependencies({ deleteProduct, deleteImage, invalidateCatalog })
      )
    ).rejects.toThrow("Google Sheets unavailable");

    expect(deleteImage).not.toHaveBeenCalled();
    expect(invalidateCatalog).not.toHaveBeenCalled();
  });

  it("still reports success when Blob cleanup fails after the row is gone", async () => {
    const invalidateCatalog = vi.fn();
    const result = await deleteAdminProductWithImageCleanup(
      product.productId,
      makeDependencies({
        deleteImage: vi.fn(async () => ({ status: "failed" as const })),
        invalidateCatalog
      })
    );

    // The product is gone; cleanup is advisory and must not roll it back.
    expect(result.product.productId).toBe(product.productId);
    expect(result.imageCleanup).toBe("failed");
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a blank IMAGE_URL", ""],
    ["the bundled placeholder", productImagePlaceholder],
    ["an external image host", "https://images.example.com/products/shirt.png"]
  ])("still deletes the product when it has %s", async (_label, imageUrl) => {
    const deleteProduct = vi.fn(async () => undefined);
    const result = await deleteAdminProductWithImageCleanup(
      product.productId,
      makeDependencies({
        listProducts: vi.fn(async () => [{ ...product, imageUrl }]),
        deleteProduct,
        deleteImage: vi.fn(async () =>
          deleteProductImageBestEffort(imageUrl, {
            deleteBlob: (() => {
              throw new Error("must not be called");
            }) as never
          })
        )
      })
    );

    expect(deleteProduct).toHaveBeenCalledWith(product.productId);
    expect(result.imageCleanup).toBe("skipped");
  });
});

describe("Blob cleanup safety", () => {
  it("only recognises this app's product-image prefix on Blob storage", () => {
    expect(isProductImageBlobUrl(blobImageUrl)).toBe(true);
    expect(
      isProductImageBlobUrl("https://blob.vercel-storage.com/products/a.png")
    ).toBe(true);

    expect(isProductImageBlobUrl("")).toBe(false);
    expect(isProductImageBlobUrl(productImagePlaceholder)).toBe(false);
    expect(isProductImageBlobUrl("not a url")).toBe(false);
    expect(isProductImageBlobUrl("https://images.example.com/a.png")).toBe(false);
    // Right host, wrong prefix — never delete something we did not write.
    expect(
      isProductImageBlobUrl("https://store.public.blob.vercel-storage.com/slips/a.png")
    ).toBe(false);
    // Look-alike host must not pass.
    expect(
      isProductImageBlobUrl("https://blob.vercel-storage.com.evil.test/products/a.png")
    ).toBe(false);
  });

  it("skips deletion for blank, placeholder, and external URLs", async () => {
    const deleteBlob = vi.fn();

    for (const value of [
      "",
      "   ",
      productImagePlaceholder,
      "https://images.example.com/products/shirt.png"
    ]) {
      const result = await deleteProductImageBestEffort(value, {
        deleteBlob: deleteBlob as never
      });
      expect(result.status).toBe("skipped");
    }

    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("reports failure instead of throwing when Blob deletion errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await deleteProductImageBestEffort(blobImageUrl, {
      deleteBlob: (async () => {
        throw new Error("blob unavailable");
      }) as never,
      blobAuth: { oidcToken: "test-oidc-token", storeId: "store_test" }
    });

    expect(result).toEqual({ status: "failed" });
    // Warning must not leak credentials or URLs.
    expect(warn).toHaveBeenCalledWith(
      "Product image cleanup failed",
      expect.objectContaining({ errorName: "Error" })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("test-oidc-token");
    warn.mockRestore();
  });

  it("deletes with OIDC options and never a read/write token", async () => {
    const deleteBlob = vi.fn(async (_url: string, _options: unknown) => undefined);

    await deleteProductImageBestEffort(blobImageUrl, {
      deleteBlob: deleteBlob as never,
      blobAuth: { oidcToken: "test-oidc-token", storeId: "store_test" }
    });

    expect(deleteBlob).toHaveBeenCalledWith(blobImageUrl, {
      oidcToken: "test-oidc-token",
      storeId: "store_test"
    });
    expect(deleteBlob.mock.calls[0][1]).not.toHaveProperty("token");
  });
});

describe("Products sheet row deletion", () => {
  const env = {
    GOOGLE_ORDER_SPREADSHEET_ID: "sheet-1",
    GOOGLE_PRODUCTS_RANGE: "Products!A:H"
  };
  const header = [
    "PRODUCT_ID",
    "UNIVERSITY",
    "SHIRT_COLOR",
    "PRICE",
    "IMAGE_URL",
    "AVAILABLE_SIZES",
    "ACTIVE",
    "SORT_ORDER"
  ];

  type BatchUpdateRequest = {
    requestBody: { requests: { deleteDimension: { range: unknown } }[] };
  };

  function makeSheets(rows: unknown[][]) {
    const batchUpdate = vi.fn(async (_request: BatchUpdateRequest) => ({}));

    return {
      batchUpdate,
      sheets: {
        spreadsheets: {
          values: { get: vi.fn(async () => ({ data: { values: rows } })) },
          get: vi.fn(async () => ({
            data: { sheets: [{ properties: { sheetId: 77, title: "Products" } }] }
          })),
          batchUpdate
        }
      } as never
    };
  }

  it("deletes the row matching PRODUCT_ID, resolved at delete time", async () => {
    const { sheets, batchUpdate } = makeSheets([
      header,
      ["kg-a", "BANGMOD", "A", 390, "", "M", "TRUE", 1],
      ["kg-b", "BANGMOD", "B", 390, "", "M", "TRUE", 2],
      ["kg-c", "BANGMOD", "C", 390, "", "M", "TRUE", 3]
    ]);

    await deleteProductRowWithClient(sheets, env, "kg-b");

    expect(batchUpdate).toHaveBeenCalledTimes(1);
    const request = batchUpdate.mock.calls[0][0];
    expect(request.requestBody.requests[0].deleteDimension.range).toEqual({
      sheetId: 77,
      dimension: "ROWS",
      // Range index 2 == sheet row 3 == zero-based dimension index 2.
      startIndex: 2,
      endIndex: 3
    });
  });

  it("never deletes the header row", async () => {
    const { sheets, batchUpdate } = makeSheets([
      header,
      ["kg-a", "BANGMOD", "A", 390, "", "M", "TRUE", 1]
    ]);

    await expect(
      deleteProductRowWithClient(sheets, env, "PRODUCT_ID")
    ).rejects.toMatchObject({ status: 404 });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown PRODUCT_ID", async () => {
    const { sheets, batchUpdate } = makeSheets([
      header,
      ["kg-a", "BANGMOD", "A", 390, "", "M", "TRUE", 1]
    ]);

    await expect(
      deleteProductRowWithClient(sheets, env, "missing")
    ).rejects.toMatchObject({ status: 404 });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("refuses to guess when PRODUCT_ID is duplicated in the sheet", async () => {
    const { sheets, batchUpdate } = makeSheets([
      header,
      ["kg-dupe", "BANGMOD", "A", 390, "", "M", "TRUE", 1],
      ["kg-dupe", "LADKRABANG", "B", 390, "", "M", "TRUE", 2]
    ]);

    await expect(
      deleteProductRowWithClient(sheets, env, "kg-dupe")
    ).rejects.toMatchObject({ status: 409 });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("surfaces a safe error when the Sheets API fails", async () => {
    const { sheets } = makeSheets([
      header,
      ["kg-a", "BANGMOD", "A", 390, "", "M", "TRUE", 1]
    ]);
    (sheets as never as {
      spreadsheets: { batchUpdate: ReturnType<typeof vi.fn> };
    }).spreadsheets.batchUpdate = vi.fn(async () => {
      throw new Error("Sheets 503");
    });

    await expect(
      deleteProductRowWithClient(sheets, env, "kg-a")
    ).rejects.toThrow("Sheets 503");
  });
});

describe("delete endpoint security", () => {
  it("rejects an unauthenticated delete request", async () => {
    const request = new Request(
      "https://shop.example/api/admin/products/kg-bm-aurora",
      { method: "DELETE", headers: { origin: "https://shop.example" } }
    );

    const response = await deleteProductRequest(request, {
      params: Promise.resolve({ productId: "kg-bm-aurora" })
    });
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(body).not.toContain("VERCEL_OIDC_TOKEN");
    expect(body).not.toContain("ADMIN_SESSION_SECRET");
  });
});

describe("historical orders after product deletion", () => {
  it("keeps colour, size, quantity, and unit price on OrderItems rows", () => {
    // This product no longer exists in the catalog — the order carries its
    // own snapshot and must still map to complete OrderItems rows.
    const order: ConfirmedOrder = {
      orderId: "KG-2026-A8F2B91C",
      createdAtIso: "2026-08-29T10:00:00.000Z",
      universityId: "bangmod",
      checkout: {
        fullName: "Ada Lovelace",
        phone: "0812345678",
        deliveryMethod: "pickup",
        shippingAddress: ""
      },
      items: [
        {
          lineId: "bangmod:kg-bm-aurora:4XL",
          productId: "kg-bm-aurora",
          universityId: "bangmod",
          productName: "Aurora Glow Shirt",
          colorName: "Aurora Glow",
          size: "4XL",
          quantity: 2,
          basePriceThb: 450,
          sizeSurchargeThb: 15,
          unitPriceThb: 465,
          image: blobImageUrl
        }
      ],
      itemSubtotalThb: 930,
      shippingFeeThb: 0,
      finalTotalThb: 930,
      paymentStatus: "pending",
      slipSelected: true
    };

    const rows = mapOrderToSheetRows(order);

    expect(rows.orderItemsRows[0]).toEqual([
      "KG-2026-A8F2B91C",
      "KG-2026-A8F2B91C-01",
      "kg-bm-aurora",
      "Aurora Glow",
      "4XL",
      2,
      465,
      930
    ]);
  });
});
