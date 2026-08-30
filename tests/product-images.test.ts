import { describe, expect, it, vi } from "vitest";
import {
  deleteProductImageBestEffort,
  uploadProductImage,
  validateProductImage
} from "@/lib/server/product-image";
import { POST as createProductRequest } from "@/app/api/admin/products/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

describe("product image storage", () => {
  it("rejects invalid image content even when MIME claims PNG", async () => {
    const file = new File(["not an image"], "image.png", { type: "image/png" });

    await expect(validateProductImage(file)).rejects.toMatchObject({ status: 400 });
  });

  it("uploads a validated image under a controlled pathname", async () => {
    const putBlob = vi.fn(
      async (_pathname: string, _body: File, _options: unknown) => ({
        url: "https://store.public.blob.vercel-storage.com/products/kg-bm-aurora/image.png"
      })
    );
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "../../secrets.txt",
      { type: "image/png" }
    );

    const url = await uploadProductImage("kg-bm-aurora", file, {
      putBlob: putBlob as never,
      blobAuth: {
        oidcToken: "test-oidc-token",
        storeId: "store_test"
      },
      now: () => 1234,
      randomId: () => "safe-random-id"
    });

    expect(url).toContain("blob.vercel-storage.com");
    expect(putBlob).toHaveBeenCalledWith(
      "products/kg-bm-aurora/1234-safe-random-id.png",
      file,
      expect.objectContaining({
        access: "public",
        addRandomSuffix: false,
        oidcToken: "test-oidc-token",
        storeId: "store_test"
      })
    );
    expect(putBlob.mock.calls[0][2]).not.toHaveProperty("token");
    expect(putBlob.mock.calls[0][0]).not.toContain("secrets.txt");
  });

  it("deletes old Vercel Blob images with OIDC store options", async () => {
    const deleteBlob = vi.fn(async () => undefined);

    await deleteProductImageBestEffort(
      "https://store.public.blob.vercel-storage.com/products/old.png",
      {
        deleteBlob: deleteBlob as never,
        blobAuth: {
          oidcToken: "test-oidc-token",
          storeId: "store_test"
        }
      }
    );

    expect(deleteBlob).toHaveBeenCalledWith(
      "https://store.public.blob.vercel-storage.com/products/old.png",
      {
        oidcToken: "test-oidc-token",
        storeId: "store_test"
      }
    );
  });

  it("rejects unauthenticated product upload requests before reading the body", async () => {
    const request = new Request("https://shop.example/api/admin/products", {
      method: "POST",
      headers: { origin: "https://shop.example" }
    });
    const response = await createProductRequest(request);
    const responseText = await response.text();

    expect(response.status).toBe(401);
    expect(responseText).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(responseText).not.toContain("VERCEL_OIDC_TOKEN");
    expect(responseText).not.toContain("ADMIN_SESSION_SECRET");
  });
});
