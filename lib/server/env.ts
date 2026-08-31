import "server-only";

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

const requiredSupabaseEnvKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

export type SupabaseEnv = Record<(typeof requiredSupabaseEnvKeys)[number], string>;

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

export function getSupabaseEnv(): SupabaseEnv {
  const config = Object.fromEntries(
    requiredSupabaseEnvKeys.map((key) => [key, process.env[key]?.trim() ?? ""])
  ) as SupabaseEnv;
  const missing = requiredSupabaseEnvKeys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}`
    );
  }

  return config;
}
