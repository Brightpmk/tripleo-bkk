import "server-only";

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { getGoogleDriveEnv, type GoogleDriveOAuthEnv } from "./env";
import type { ValidatedPaymentSlip } from "./payment-slip-validation";

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export type PaymentSlipUploadInput = ValidatedPaymentSlip & {
  orderId: string;
  createdAt: Date;
};

export type StoredPaymentSlip = {
  fileId: string;
};

export type StoredPaymentSlipContent = {
  buffer: Buffer;
  mimeType: string;
};

export type PaymentSlipStorage = {
  upload(input: PaymentSlipUploadInput): Promise<StoredPaymentSlip>;
  delete(fileId: string): Promise<void>;
};

export class GoogleDriveSlipStorage implements PaymentSlipStorage {
  private readonly drive: drive_v3.Drive;
  private readonly folderId: string;

  constructor(drive?: drive_v3.Drive, folderId?: string) {
    if (drive && folderId) {
      this.drive = drive;
      this.folderId = folderId;
      return;
    }

    const env = getGoogleDriveEnv();
    const auth = createDriveOAuthClient(env);

    this.drive = google.drive({ version: "v3", auth });
    this.folderId = env.GOOGLE_DRIVE_SLIP_FOLDER_ID;
  }

  async upload(input: PaymentSlipUploadInput): Promise<StoredPaymentSlip> {
    const fileName = buildSlipFileName(input);
    const response = await this.drive.files.create({
      requestBody: {
        name: fileName,
        parents: [this.folderId],
        mimeType: input.mimeType
      },
      media: {
        mimeType: input.mimeType,
        body: Readable.from(input.buffer)
      },
      fields: "id"
    });

    const fileId = response.data.id;

    if (!fileId) {
      throw new Error("Google Drive did not return a file ID.");
    }

    return { fileId };
  }

  async delete(fileId: string) {
    await this.drive.files.delete({ fileId });
  }

  /**
   * Fetches slip bytes through the server's own Drive credentials.
   *
   * Intentionally not part of PaymentSlipStorage: only the authenticated
   * admin slip route uses it. The Drive file stays private — nothing is ever
   * made link-shareable, and no credential reaches the browser.
   */
  async read(fileId: string): Promise<StoredPaymentSlipContent> {
    const metadata = await this.drive.files.get({
      fileId,
      fields: "mimeType,size"
    });
    const content = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    return {
      buffer: Buffer.from(content.data as ArrayBuffer),
      mimeType: metadata.data.mimeType ?? "application/octet-stream"
    };
  }
}

export function createDriveOAuthClient(env: GoogleDriveOAuthEnv) {
  const auth = new google.auth.OAuth2(
    env.GOOGLE_DRIVE_CLIENT_ID,
    env.GOOGLE_DRIVE_CLIENT_SECRET
  );

  auth.setCredentials({
    refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN
  });

  return auth;
}

export function buildSlipFileName(input: PaymentSlipUploadInput) {
  const datePart = input.createdAt.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = randomBytes(3).toString("hex");

  return `${input.orderId}-${datePart}-${randomPart}.${input.extension}`;
}
