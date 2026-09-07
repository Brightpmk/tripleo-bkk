import { describe, expect, it, vi } from "vitest";
import type { del, get, put } from "@vercel/blob";
import {
  createDriveOAuthClient,
  GoogleDriveSlipStorage,
  PaymentSlipStorageRouter,
  VercelBlobSlipStorage,
  type ReadablePaymentSlipStorage
} from "@/lib/server/payment-slip-storage";

vi.mock("server-only", () => ({}));

const orderId = "KG-2026-A8F2B91C";
const uuid = "123e4567-e89b-42d3-a456-426614174000";
const pathname = `payment-slips/${orderId}/${uuid}.jpg`;
const reference = `blob:v1:${pathname}`;
const input = {
  orderId,
  createdAt: new Date("2026-08-29T10:00:00.000Z"),
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg" as const,
  extension: "jpg" as const
};

function blobMetadata() {
  return {
    url: `https://private.example/${pathname}`,
    downloadUrl: `https://private.example/${pathname}?download=1`,
    pathname,
    contentDisposition: "inline",
    contentType: "image/jpeg",
    cacheControl: "public, max-age=60",
    uploadedAt: new Date(),
    size: input.buffer.byteLength,
    etag: "etag"
  };
}

describe("private Vercel Blob slip storage", () => {
  it("uploads with private access and persists only an opaque pathname reference", async () => {
    const putBlob = vi.fn(async () => blobMetadata()) as unknown as typeof put;
    const storage = new VercelBlobSlipStorage({
      putBlob,
      randomId: () => uuid,
      blobAuth: { storeId: "store_private", oidcToken: "test-oidc" }
    });

    const result = await storage.upload(input);

    expect(result).toEqual({ fileId: reference });
    expect(result.fileId).not.toContain("https://");
    expect(putBlob).toHaveBeenCalledWith(pathname, input.buffer, {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/jpeg",
      cacheControlMaxAge: 60,
      storeId: "store_private",
      oidcToken: "test-oidc"
    });
  });

  it("reads a private blob by validated pathname", async () => {
    const getBlob = vi.fn(async () => ({
      statusCode: 200 as const,
      stream: new Blob([input.buffer]).stream(),
      headers: new Headers(),
      blob: blobMetadata()
    })) as unknown as typeof get;
    const storage = new VercelBlobSlipStorage({
      getBlob,
      blobAuth: { storeId: "store_private", oidcToken: "test-oidc" }
    });

    const content = await storage.read(reference);

    expect(content).toEqual({ buffer: input.buffer, mimeType: "image/jpeg" });
    expect(getBlob).toHaveBeenCalledWith(pathname, {
      access: "private",
      storeId: "store_private",
      oidcToken: "test-oidc"
    });
  });

  it("deletes only validated payment-slip references", async () => {
    const deleteBlob = vi.fn(async () => undefined) as unknown as typeof del;
    const storage = new VercelBlobSlipStorage({
      deleteBlob,
      blobAuth: { storeId: "store_private", oidcToken: "test-oidc" }
    });

    await storage.delete(reference);
    await expect(
      storage.delete("blob:v1:products/another-product/image.jpg")
    ).rejects.toThrow("Invalid private Blob payment slip reference");

    expect(deleteBlob).toHaveBeenCalledTimes(1);
    expect(deleteBlob).toHaveBeenCalledWith(pathname, {
      storeId: "store_private",
      oidcToken: "test-oidc"
    });
  });
});

describe("payment slip transition router", () => {
  it("uses Blob for new writes and Blob-prefixed references", async () => {
    const blobStorage: ReadablePaymentSlipStorage = {
      upload: vi.fn(async () => ({ fileId: reference })),
      read: vi.fn(async () => ({ buffer: input.buffer, mimeType: "image/jpeg" })),
      delete: vi.fn(async () => undefined)
    };
    const driveFactory = vi.fn();
    const router = new PaymentSlipStorageRouter(blobStorage, driveFactory);

    expect(await router.upload(input)).toEqual({ fileId: reference });
    await router.read(reference);
    await router.delete(reference);

    expect(blobStorage.upload).toHaveBeenCalled();
    expect(blobStorage.read).toHaveBeenCalledWith(reference);
    expect(blobStorage.delete).toHaveBeenCalledWith(reference);
    expect(driveFactory).not.toHaveBeenCalled();
  });

  it("keeps historical unprefixed Drive references readable", async () => {
    const blobStorage = {
      upload: vi.fn(),
      read: vi.fn(),
      delete: vi.fn()
    } as unknown as ReadablePaymentSlipStorage;
    const driveStorage: ReadablePaymentSlipStorage = {
      upload: vi.fn(),
      read: vi.fn(async () => ({ buffer: input.buffer, mimeType: "image/jpeg" })),
      delete: vi.fn(async () => undefined)
    };
    const router = new PaymentSlipStorageRouter(blobStorage, () => driveStorage);

    await router.read("historical_Drive-id-123");
    await router.delete("historical_Drive-id-123");

    expect(driveStorage.read).toHaveBeenCalledWith("historical_Drive-id-123");
    expect(driveStorage.delete).toHaveBeenCalledWith("historical_Drive-id-123");
    expect(blobStorage.read).not.toHaveBeenCalled();
  });
});

describe("historical Google Drive slip storage", () => {
  it("configures OAuth with the owner refresh token", () => {
    const auth = createDriveOAuthClient({
      GOOGLE_DRIVE_CLIENT_ID: "client-id",
      GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
      GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token"
    });
    expect(auth.credentials.refresh_token).toBe("refresh-token");
  });

  it("validates historical IDs before deleting", async () => {
    const deleteFile = vi.fn(async () => undefined);
    const storage = new GoogleDriveSlipStorage(
      { files: { delete: deleteFile } } as unknown as ConstructorParameters<
        typeof GoogleDriveSlipStorage
      >[0]
    );

    await storage.delete("historical_Drive-id-123");
    await expect(storage.delete("../bad id")).rejects.toThrow(
      "Invalid historical Drive payment slip reference"
    );
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });
});
