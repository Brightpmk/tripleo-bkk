import { describe, expect, it, vi } from "vitest";
import type { AdminProduct } from "@/lib/admin-products";
import {
  ProductAdminError,
  validateAdminProductInput
} from "@/lib/server/product-admin";
import {
  createAdminProductWithImage,
  updateAdminProductWithOptionalImage
} from "@/lib/server/product-admin-operations";

vi.mock("server-only", () => ({}));

const validProduct: AdminProduct = {
  productId: "kg-bm-aurora",
  university: "BANGMOD",
  jerseyColor: "Aurora Glow",
  priceThb: 450,
  imageUrl: "https://store.public.blob.vercel-storage.com/products/aurora.png",
  availableSizes: ["S", "M", "XL"],
  active: true,
  sortOrder: 4
};

describe("admin product validation", () => {
  it("accepts a valid product and arbitrary new JerseyColor", () => {
    expect(
      validateAdminProductInput({
        ...validProduct,
        jerseyColor: "Salted Caramel Cloud"
      }).jerseyColor
    ).toBe("Salted Caramel Cloud");
  });

  it.each([
    ["university", { university: "SOMEWHERE" }],
    ["priceThb", { priceThb: -1 }],
    ["priceThb", { priceThb: 390.999 }],
    ["availableSizes", { availableSizes: ["M", "HUGE"] }]
  ])("rejects invalid %s", (field, override) => {
    try {
      validateAdminProductInput({ ...validProduct, ...override });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductAdminError);
      expect((error as InstanceType<typeof ProductAdminError>).fieldErrors).toHaveProperty(field);
    }
  });
});

describe("admin product operations", () => {
  it("creates a valid product, stores the uploaded URL, and invalidates cache", async () => {
    const createProduct = vi.fn(async (product: Record<string, unknown>) =>
      product as unknown as AdminProduct
    );
    const invalidateCatalog = vi.fn();
    const image = new File([pngBytes()], "untrusted name.png", { type: "image/png" });

    const created = await createAdminProductWithImage(validProduct, image, {
      listProducts: vi.fn(async () => []),
      createProduct,
      updateProduct: vi.fn(),
      uploadImage: vi.fn(async () => "https://store.public.blob.vercel-storage.com/products/new.png"),
      deleteImage: vi.fn(),
      invalidateCatalog
    });

    expect(created.imageUrl).toContain("blob.vercel-storage.com");
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ productId: validProduct.productId })
    );
    expect(invalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate PRODUCT_ID before uploading", async () => {
    const uploadImage = vi.fn();

    await expect(
      createAdminProductWithImage(
        validProduct,
        new File([pngBytes()], "image.png", { type: "image/png" }),
        {
          listProducts: vi.fn(async () => [validProduct]),
          createProduct: vi.fn(),
          updateProduct: vi.fn(),
          uploadImage,
          deleteImage: vi.fn(),
          invalidateCatalog: vi.fn()
        }
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("updates by PRODUCT_ID, including active, price, sizes, and new color", async () => {
    const updateProduct = vi.fn(
      async (_id: string, product: Record<string, unknown>) =>
        product as unknown as AdminProduct
    );
    const updated = await updateAdminProductWithOptionalImage(
      validProduct.productId,
      {
        ...validProduct,
        productId: "client-cannot-change-this",
        active: false,
        priceThb: 525,
        availableSizes: ["XS", "2XL"],
        jerseyColor: "Future Flavor"
      },
      null,
      {
        listProducts: vi.fn(async () => [validProduct]),
        createProduct: vi.fn(),
        updateProduct,
        uploadImage: vi.fn(),
        deleteImage: vi.fn(),
        invalidateCatalog: vi.fn()
      }
    );

    expect(updateProduct).toHaveBeenCalledWith(
      validProduct.productId,
      expect.objectContaining({ productId: validProduct.productId })
    );
    expect(updated).toMatchObject({
      active: false,
      priceThb: 525,
      availableSizes: ["XS", "2XL"],
      jerseyColor: "Future Flavor"
    });
  });
});

function pngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
}
