import "server-only";

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { getGoogleDriveEnv, normalizePrivateKey } from "./env";
import type { ValidatedPaymentSlip } from "./payment-slip-validation";

export type PaymentSlipUploadInput = ValidatedPaymentSlip & {
  orderId: string;
  createdAt: Date;
};

export type StoredPaymentSlip = {
  fileId: string;
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
    const auth = new google.auth.JWT({
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      scopes: ["https://www.googleapis.com/auth/drive.file"]
    });

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
}

export function buildSlipFileName(input: PaymentSlipUploadInput) {
  const datePart = input.createdAt.toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = randomBytes(3).toString("hex");

  return `${input.orderId}-${datePart}-${randomPart}.${input.extension}`;
}
