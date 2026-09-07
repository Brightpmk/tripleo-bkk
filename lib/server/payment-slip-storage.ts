import "server-only";

import { del, get, put } from "@vercel/blob";
import type {
  DeleteCommandOptions,
  GetCommandOptions,
  PutCommandOptions
} from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { google, type drive_v3 } from "googleapis";
import {
  getGoogleDriveEnv,
  getPaymentSlipBlobStoreEnv,
  type GoogleDriveOAuthEnv
} from "./env";
import type { ValidatedPaymentSlip } from "./payment-slip-validation";

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
export const PAYMENT_SLIP_BLOB_PREFIX = "payment-slips/";
export const PAYMENT_SLIP_BLOB_REFERENCE_PREFIX = "blob:v1:";

const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const BLOB_PATH_PATTERN =
  /^payment-slips\/([A-Za-z0-9][A-Za-z0-9_-]{2,63})\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

export type PaymentSlipUploadInput = ValidatedPaymentSlip & {
  orderId: string;
  createdAt: Date;
};

export type StoredPaymentSlip = {
  /** Opaque storage reference persisted in orders.slip_file_id. */
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

export type ReadablePaymentSlipStorage = PaymentSlipStorage & {
  read(fileId: string): Promise<StoredPaymentSlipContent>;
};

type HistoricalPaymentSlipStorage = Pick<
  ReadablePaymentSlipStorage,
  "read" | "delete"
>;

type BlobAuthOptions = Pick<
  PutCommandOptions & GetCommandOptions & DeleteCommandOptions,
  "oidcToken" | "storeId"
>;

export type VercelBlobSlipStorageOptions = {
  putBlob?: typeof put;
  getBlob?: typeof get;
  deleteBlob?: typeof del;
  blobAuth?: BlobAuthOptions;
  randomId?: () => string;
};

/** New payment slips live in a dedicated private Vercel Blob store. */
export class VercelBlobSlipStorage implements PaymentSlipStorage {
  constructor(private readonly options: VercelBlobSlipStorageOptions = {}) {}

  async upload(input: PaymentSlipUploadInput): Promise<StoredPaymentSlip> {
    const pathname = buildSlipBlobPath(
      input.orderId,
      input.extension,
      (this.options.randomId ?? randomUUID)()
    );
    const blob = await (this.options.putBlob ?? put)(pathname, input.buffer, {
      access: "private",
      addRandomSuffix: false,
      contentType: input.mimeType,
      cacheControlMaxAge: 60,
      ...getSlipBlobAuth(this.options.blobAuth)
    });

    if (blob.pathname !== pathname) {
      throw new Error("Payment slip storage returned an unexpected pathname.");
    }

    return { fileId: encodeBlobSlipReference(pathname) };
  }

  async read(fileId: string): Promise<StoredPaymentSlipContent> {
    const pathname = decodeBlobSlipReference(fileId);
    const result = await (this.options.getBlob ?? get)(pathname, {
      access: "private",
      ...getSlipBlobAuth(this.options.blobAuth)
    });

    if (!result || result.statusCode !== 200 || result.blob.pathname !== pathname) {
      throw new Error("Payment slip was not found in private storage.");
    }

    if (!isSupportedSlipMimeType(result.blob.contentType)) {
      throw new Error("Payment slip storage returned an unsupported content type.");
    }

    return {
      buffer: Buffer.from(await new Response(result.stream).arrayBuffer()),
      mimeType: result.blob.contentType
    };
  }

  async delete(fileId: string) {
    const pathname = decodeBlobSlipReference(fileId);
    await (this.options.deleteBlob ?? del)(
      pathname,
      getSlipBlobAuth(this.options.blobAuth)
    );
  }
}

/**
 * Transition adapter: new writes always use Blob; unprefixed historical IDs
 * continue through Drive until those records have been migrated and verified.
 */
export class PaymentSlipStorageRouter implements ReadablePaymentSlipStorage {
  constructor(
    private readonly blobStorage: ReadablePaymentSlipStorage = new VercelBlobSlipStorage(),
    private readonly driveStorageFactory: () => HistoricalPaymentSlipStorage = () =>
      new GoogleDriveSlipStorage()
  ) {}

  upload(input: PaymentSlipUploadInput) {
    return this.blobStorage.upload(input);
  }

  read(fileId: string) {
    return isBlobSlipReference(fileId)
      ? this.blobStorage.read(fileId)
      : this.driveStorageFactory().read(fileId);
  }

  delete(fileId: string) {
    return isBlobSlipReference(fileId)
      ? this.blobStorage.delete(fileId)
      : this.driveStorageFactory().delete(fileId);
  }
}

/** Historical Drive support only; no new runtime upload uses this class. */
export class GoogleDriveSlipStorage implements HistoricalPaymentSlipStorage {
  private readonly drive: drive_v3.Drive;

  constructor(drive?: drive_v3.Drive) {
    if (drive) {
      this.drive = drive;
      return;
    }

    const env = getGoogleDriveEnv();
    const auth = createDriveOAuthClient(env);

    this.drive = google.drive({ version: "v3", auth });
  }

  async delete(fileId: string) {
    assertDriveFileId(fileId);
    await this.drive.files.delete({ fileId });
  }

  async read(fileId: string): Promise<StoredPaymentSlipContent> {
    assertDriveFileId(fileId);
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
  auth.setCredentials({ refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN });
  return auth;
}

export function buildSlipBlobPath(
  orderId: string,
  extension: ValidatedPaymentSlip["extension"],
  randomId: string
) {
  const pathname = `${PAYMENT_SLIP_BLOB_PREFIX}${orderId}/${randomId}.${extension}`;
  if (!ORDER_ID_PATTERN.test(orderId) || !BLOB_PATH_PATTERN.test(pathname)) {
    throw new Error("Invalid payment slip storage pathname.");
  }
  return pathname;
}

export function encodeBlobSlipReference(pathname: string) {
  if (!BLOB_PATH_PATTERN.test(pathname)) {
    throw new Error("Invalid payment slip storage pathname.");
  }
  return `${PAYMENT_SLIP_BLOB_REFERENCE_PREFIX}${pathname}`;
}

export function decodeBlobSlipReference(fileId: string) {
  if (!fileId.startsWith(PAYMENT_SLIP_BLOB_REFERENCE_PREFIX)) {
    throw new Error("Invalid private Blob payment slip reference.");
  }
  const pathname = fileId.slice(PAYMENT_SLIP_BLOB_REFERENCE_PREFIX.length);
  if (!BLOB_PATH_PATTERN.test(pathname)) {
    throw new Error("Invalid private Blob payment slip reference.");
  }
  return pathname;
}

export function isBlobSlipReference(fileId: string) {
  return fileId.startsWith(PAYMENT_SLIP_BLOB_REFERENCE_PREFIX);
}

function getSlipBlobAuth(overrides?: BlobAuthOptions): BlobAuthOptions {
  const storeId =
    overrides?.storeId?.trim() ||
    getPaymentSlipBlobStoreEnv().PAYMENT_SLIP_BLOB_STORE_ID;
  const oidcToken = overrides?.oidcToken?.trim();
  return { storeId, ...(oidcToken ? { oidcToken } : {}) };
}

function assertDriveFileId(fileId: string) {
  if (!DRIVE_FILE_ID_PATTERN.test(fileId)) {
    throw new Error("Invalid historical Drive payment slip reference.");
  }
}

function isSupportedSlipMimeType(value: string) {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}
