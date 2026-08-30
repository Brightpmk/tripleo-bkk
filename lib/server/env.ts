import "server-only";

const requiredEnvKeys = [
  "GOOGLE_ORDER_SPREADSHEET_ID",
  "GOOGLE_ORDERS_RANGE",
  "GOOGLE_ORDER_ITEMS_RANGE",
  "GOOGLE_PRODUCTS_RANGE",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
] as const;

export type GoogleSheetsEnv = Record<(typeof requiredEnvKeys)[number], string>;

const requiredDriveOAuthEnvKeys = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_SLIP_FOLDER_ID"
] as const;

export type GoogleDriveOAuthEnv = Record<
  (typeof requiredDriveOAuthEnvKeys)[number],
  string
>;

export type BlobStoreEnv = {
  BLOB_STORE_ID: string;
};

export function getGoogleSheetsEnv(): GoogleSheetsEnv {
  const config = Object.fromEntries(
    requiredEnvKeys.map((key) => [key, process.env[key]?.trim() ?? ""])
  ) as GoogleSheetsEnv;

  const missing = requiredEnvKeys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}`
    );
  }

  return config;
}

export function getGoogleDriveEnv() {
  const config = Object.fromEntries(
    requiredDriveOAuthEnvKeys.map((key) => [
      key,
      process.env[key]?.trim() ?? ""
    ])
  ) as GoogleDriveOAuthEnv;
  const missing = requiredDriveOAuthEnvKeys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}`
    );
  }

  return config;
}

export function getBlobStoreEnv(): BlobStoreEnv {
  const storeId = process.env.BLOB_STORE_ID?.trim() ?? "";

  if (!storeId) {
    throw new Error("Missing required server environment variable: BLOB_STORE_ID");
  }

  return { BLOB_STORE_ID: storeId };
}

export function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, "\n");
}
