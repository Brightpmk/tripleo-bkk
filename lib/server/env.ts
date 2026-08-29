import "server-only";

const requiredEnvKeys = [
  "GOOGLE_ORDER_SPREADSHEET_ID",
  "GOOGLE_ORDERS_RANGE",
  "GOOGLE_ORDER_ITEMS_RANGE",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_DRIVE_SLIP_FOLDER_ID"
] as const;

export type GoogleSheetsEnv = Record<(typeof requiredEnvKeys)[number], string>;

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
  const env = getGoogleSheetsEnv();

  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_DRIVE_SLIP_FOLDER_ID: env.GOOGLE_DRIVE_SLIP_FOLDER_ID
  };
}

export function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, "\n");
}
