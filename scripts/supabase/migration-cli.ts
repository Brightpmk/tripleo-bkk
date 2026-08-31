import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import type {
  MigrationReport,
  NormalizedMigrationData,
  SheetRows,
  SupabaseOrderInsert,
  SupabaseOrderItemInsert,
  SupabaseProductInsert
} from "../../lib/supabase/migration-data";

type SheetEnv = {
  GOOGLE_ORDER_SPREADSHEET_ID: string;
  GOOGLE_ORDERS_RANGE: string;
  GOOGLE_ORDER_ITEMS_RANGE: string;
  GOOGLE_PRODUCTS_RANGE: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
};

type SupabaseEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type MigrationEnv = SheetEnv & SupabaseEnv;

const sheetEnvKeys = [
  "GOOGLE_ORDER_SPREADSHEET_ID",
  "GOOGLE_ORDERS_RANGE",
  "GOOGLE_ORDER_ITEMS_RANGE",
  "GOOGLE_PRODUCTS_RANGE",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
] as const;

const supabaseEnvKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

export function getMigrationEnv(): MigrationEnv {
  return {
    ...getSheetEnv(),
    ...getSupabaseEnv()
  };
}

export function getSheetEnv(): SheetEnv {
  const keys = [...sheetEnvKeys];
  const config = Object.fromEntries(
    keys.map((key) => [key, process.env[key]?.trim() ?? ""])
  ) as SheetEnv;
  const missing = keys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

export function getSupabaseEnv(): SupabaseEnv {
  const keys = [...supabaseEnvKeys];
  const config = Object.fromEntries(
    keys.map((key) => [key, process.env[key]?.trim() ?? ""])
  ) as SupabaseEnv;
  const missing = keys.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

export async function readGoogleSheetSource(env: SheetEnv): Promise<SheetRows> {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    ranges: [
      env.GOOGLE_PRODUCTS_RANGE,
      env.GOOGLE_ORDERS_RANGE,
      env.GOOGLE_ORDER_ITEMS_RANGE
    ],
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const [products, orders, orderItems] = response.data.valueRanges ?? [];

  return {
    productRows: products?.values ?? [],
    orderRows: orders?.values ?? [],
    orderItemRows: orderItems?.values ?? []
  };
}

export function createSupabaseAdminClient(env: SupabaseEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        "X-Client-Info": "kinggallery-studio-phase1-migration-cli"
      }
    }
  });
}

export async function upsertMigrationData(
  supabase: SupabaseClient,
  data: NormalizedMigrationData
) {
  await upsertChunks(supabase, "products", data.products, "product_id");
  await upsertChunks(supabase, "orders", data.orders, "order_id");
  await upsertChunks(supabase, "order_items", data.orderItems, "item_id");
}

export async function getExactCount(
  supabase: SupabaseClient,
  table: "products" | "orders" | "order_items"
) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function selectAll<T>(
  supabase: SupabaseClient,
  table: "products" | "orders" | "order_items",
  columns: string
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

export function printMigrationReport(report: MigrationReport) {
  console.log("Source fields");
  console.log(`- Products: ${report.sourceFields.products.join(", ")}`);
  console.log(`- Orders: ${report.sourceFields.orders.join(", ")}`);
  console.log(`- OrderItems: ${report.sourceFields.orderItems.join(", ")}`);
  console.log("");
  console.log("Normalized row counts");
  console.log(`- Products: ${report.counts.products}`);
  console.log(`- Orders: ${report.counts.orders}`);
  console.log(`- OrderItems: ${report.counts.orderItems}`);
  console.log("");
  console.log("Skipped blank rows");
  console.log(`- Products: ${report.skippedBlankRows.products}`);
  console.log(`- Orders: ${report.skippedBlankRows.orders}`);
  console.log(`- OrderItems: ${report.skippedBlankRows.orderItems}`);

  if (report.issues.length === 0) {
    console.log("");
    console.log("Validation issues: none");
    return;
  }

  console.log("");
  console.log(`Validation issues: ${report.issues.length}`);

  for (const issue of report.issues.slice(0, 100)) {
    console.log(
      `- ${issue.sheet} row ${issue.rowNumber} [${issue.severity}/${issue.code}]: ${issue.message}`
    );
  }

  if (report.issues.length > 100) {
    console.log(`... ${report.issues.length - 100} more issues not shown`);
  }
}

export function summarizeVerification(
  source: NormalizedMigrationData,
  supabaseRows: {
    products: Array<Pick<SupabaseProductInsert, "product_id" | "university" | "active" | "image_url" | "available_sizes">>;
    orders: Array<Pick<SupabaseOrderInsert, "order_id" | "university" | "delivery_method" | "payment_status">>;
    orderItems: Array<Pick<SupabaseOrderItemInsert, "order_id" | "item_id" | "size">>;
  }
) {
  const discrepancies: string[] = [];

  compareSets(
    "Products PRODUCT_ID",
    source.products.map((row) => row.product_id),
    supabaseRows.products.map((row) => row.product_id),
    discrepancies
  );
  compareSets(
    "Orders ORDER_ID",
    source.orders.map((row) => row.order_id),
    supabaseRows.orders.map((row) => row.order_id),
    discrepancies
  );
  compareSets(
    "OrderItems ITEM_ID",
    source.orderItems.map((row) => row.item_id),
    supabaseRows.orderItems.map((row) => row.item_id),
    discrepancies
  );

  const sourceItemsByOrderId = countBy(source.orderItems, (row) => row.order_id);
  const dbItemsByOrderId = countBy(supabaseRows.orderItems, (row) => row.order_id);
  const sourceMultipleItemOrders = [...sourceItemsByOrderId.entries()]
    .filter(([, count]) => count > 1)
    .map(([orderId]) => orderId);
  const dbMultipleItemOrders = [...dbItemsByOrderId.entries()]
    .filter(([, count]) => count > 1)
    .map(([orderId]) => orderId);

  compareSets(
    "multiple-item orders",
    sourceMultipleItemOrders,
    dbMultipleItemOrders,
    discrepancies
  );

  return {
    discrepancies,
    samples: {
      productsByUniversity: countBy(source.products, (row) => row.university),
      ordersByUniversity: countBy(source.orders, (row) => row.university),
      activeProducts: source.products.filter((row) => row.active).length,
      inactiveProducts: source.products.filter((row) => !row.active).length,
      productsWithBlankImages: source.products.filter((row) => !row.image_url).length,
      productsWithExtendedSizes: source.products.filter((row) =>
        row.available_sizes.some((size) => ["3XL", "4XL", "5XL"].includes(size))
      ).length,
      pickupOrders: source.orders.filter((row) => row.delivery_method === "pickup").length,
      shippingOrders: source.orders.filter((row) => row.delivery_method === "shipping").length,
      pendingPayments: source.orders.filter((row) => row.payment_status === "pending").length,
      paidPayments: source.orders.filter((row) => row.payment_status === "verified").length,
      multipleItemOrders: sourceMultipleItemOrders.length
    }
  };
}

async function upsertChunks<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: "products" | "orders" | "order_items",
  rows: T[],
  onConflict: string
) {
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length === 0) continue;

    const { error } = await supabase
      .from(table)
      .upsert(chunk as never, { onConflict });

    if (error) {
      throw error;
    }
  }
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function compareSets(
  label: string,
  sourceValues: string[],
  dbValues: string[],
  discrepancies: string[]
) {
  const source = new Set(sourceValues);
  const db = new Set(dbValues);
  const missingInDb = [...source].filter((value) => !db.has(value));
  const extraInDb = [...db].filter((value) => !source.has(value));

  if (missingInDb.length > 0) {
    discrepancies.push(`${label} missing in Supabase: ${missingInDb.slice(0, 20).join(", ")}`);
  }

  if (extraInDb.length > 0) {
    discrepancies.push(`${label} extra in Supabase: ${extraInDb.slice(0, 20).join(", ")}`);
  }
}

function countBy<T>(rows: T[], getKey: (row: T) => string) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = getKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.replace(/\\n/g, "\n");
}
