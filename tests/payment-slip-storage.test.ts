import { describe, expect, it, vi } from "vitest";
import {
  createDriveOAuthClient,
  GoogleDriveSlipStorage
} from "@/lib/server/payment-slip-storage";

vi.mock("server-only", () => ({}));

describe("Google Drive slip storage", () => {
  it("configures OAuth with the owner refresh token", () => {
    const auth = createDriveOAuthClient({
      GOOGLE_DRIVE_CLIENT_ID: "client-id",
      GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
      GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token",
      GOOGLE_DRIVE_SLIP_FOLDER_ID: "folder-id"
    });

    expect(auth.credentials.refresh_token).toBe("refresh-token");
  });

  it("creates and deletes files in the configured folder", async () => {
    const create = vi.fn(async () => ({ data: { id: "drive-file-123" } }));
    const deleteFile = vi.fn(async () => undefined);
    const storage = new GoogleDriveSlipStorage(
      {
        files: {
          create,
          delete: deleteFile
        }
      } as unknown as ConstructorParameters<typeof GoogleDriveSlipStorage>[0],
      "folder-id"
    );

    const result = await storage.upload({
      orderId: "KG-2026-A8F2B91C",
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      extension: "jpg"
    });

    await storage.delete(result.fileId);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          parents: ["folder-id"]
        }),
        fields: "id"
      })
    );
    expect(deleteFile).toHaveBeenCalledWith({
      fileId: "drive-file-123"
    });
  });
});
