import "server-only";

import { google, type sheets_v4 } from "googleapis";
import {
  getGoogleSheetsEnv,
  normalizePrivateKey,
  type GoogleSheetsEnv
} from "./env";
import type { OrderSheetRows, SheetCell } from "./order-row-mapper";
import type { AdminProductInput } from "@/lib/admin-products";
import { ProductAdminError } from "./product-admin-error";
import { getProductHeaderMap, productToSheetRow } from "./product-sheet";

export type SheetsClient = sheets_v4.Sheets;

export type OrderSheetIds = {
  ordersSheetId: number;
  orderItemsSheetId: number;
};

/**
 * A JWT client caches its OAuth access token internally, so reusing one
 * instance across warm invocations removes a token exchange round trip from
 * every order. The client holds no per-request state.
 */
let cachedSheetsClient: SheetsClient | null = null;

/**
 * Tab IDs change only if a tab is deleted and recreated. Caching them removes
 * a spreadsheets.get round trip from the order critical path; any write
 * failure clears the cache so the next attempt re-resolves them.
 */
let cachedOrderSheetIds: OrderSheetIds | null = null;

export function resetSheetsCachesForTests() {
  cachedSheetsClient = null;
  cachedOrderSheetIds = null;
}

/**
 * Warms the Sheets auth token and tab IDs. Safe to start in parallel with
 * other work: it is read-only and never rejects — a failure just leaves the
 * cache cold so the real append resolves (and reports) it.
 */
export async function prefetchOrderSheetIds() {
  if (cachedOrderSheetIds) {
    return;
  }

  try {
    const env = getGoogleSheetsEnv();
    const sheets = getAuthenticatedSheetsClient(env);
    cachedOrderSheetIds = await resolveOrderSheetIds(sheets, env);
  } catch {
    // Warm-up only. The append path surfaces the real error.
  }
}

export async function appendOrderRows(rows: OrderSheetRows) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);
  const sheetIds =
    cachedOrderSheetIds ?? (await resolveOrderSheetIds(sheets, env));

  cachedOrderSheetIds = sheetIds;

  try {
    await appendRowsWithClient(sheets, env, rows, sheetIds);
  } catch (error) {
    // A recreated tab would make the cached IDs wrong — never reuse them
    // after a failed write.
    cachedOrderSheetIds = null;
    throw error;
  }
}

export async function resolveOrderSheetIds(
  sheets: SheetsClient,
  env: Pick<
    GoogleSheetsEnv,
    "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_ORDERS_RANGE" | "GOOGLE_ORDER_ITEMS_RANGE"
  >
): Promise<OrderSheetIds> {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)"
  });

  return {
    ordersSheetId: getSheetIdByTitle(
      spreadsheet.data.sheets,
      getSheetNameFromRange(env.GOOGLE_ORDERS_RANGE)
    ),
    orderItemsSheetId: getSheetIdByTitle(
      spreadsheet.data.sheets,
      getSheetNameFromRange(env.GOOGLE_ORDER_ITEMS_RANGE)
    )
  };
}

export type OrdersSheetEnv = Pick<
  GoogleSheetsEnv,
  "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_ORDERS_RANGE" | "GOOGLE_ORDER_ITEMS_RANGE"
>;

export async function readOrderSheets() {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);

  return readOrderSheetsWithClient(sheets, env);
}

/**
 * One read for Orders and one for OrderItems, in a single batchGet — never a
 * request per order. Callers join the two in memory.
 */
export async function readOrderSheetsWithClient(
  sheets: SheetsClient,
  env: OrdersSheetEnv
) {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    ranges: [env.GOOGLE_ORDERS_RANGE, env.GOOGLE_ORDER_ITEMS_RANGE]
  });

  const [orders, orderItems] = response.data.valueRanges ?? [];

  return {
    orderRows: orders?.values ?? [],
    orderItemRows: orderItems?.values ?? []
  };
}

export async function updateOrderRowValues(
  orderId: string,
  updates: Record<string, string>
) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);

  await updateOrderRowValuesWithClient(sheets, env, orderId, updates);
}

/**
 * Applies column updates to the single Orders row whose ORDER_ID matches.
 *
 * The row is resolved from the sheet at write time — a client-supplied row
 * number is never trusted. Columns are addressed by header name, and every
 * other cell in the row is written back unchanged.
 */
export async function updateOrderRowValuesWithClient(
  sheets: SheetsClient,
  env: Pick<GoogleSheetsEnv, "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_ORDERS_RANGE">,
  orderId: string,
  updates: Record<string, string>
) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    range: env.GOOGLE_ORDERS_RANGE
  });
  const rows = response.data.values ?? [];
  const headerRow = rows[0] ?? [];
  const headerIndex = buildHeaderIndex(headerRow);
  const orderIdIndex = headerIndex.ORDER_ID;

  if (orderIdIndex === undefined) {
    throw new OrderSheetError("Orders sheet schema is invalid.", 500);
  }

  const matches = rows.flatMap((row, index) =>
    index > 0 && String(row[orderIdIndex] ?? "").trim() === orderId ? [index] : []
  );

  if (matches.length === 0) {
    throw new OrderSheetError("Order was not found.", 404);
  }

  if (matches.length > 1) {
    throw new OrderSheetError(
      "This order ID appears more than once in the sheet, so it was not updated.",
      409
    );
  }

  const rowIndex = matches[0];
  const width = Math.max(headerRow.length, rows[rowIndex].length);
  const nextRow = Array.from(
    { length: width },
    (_, index) => rows[rowIndex][index] ?? ""
  );

  for (const [header, value] of Object.entries(updates)) {
    const columnIndex = headerIndex[header];

    if (columnIndex === undefined) {
      throw new OrderSheetError("Orders sheet schema is invalid.", 500);
    }

    nextRow[columnIndex] = value;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    range: getRowRange(env.GOOGLE_ORDERS_RANGE, rowIndex + 1),
    valueInputOption: "RAW",
    requestBody: { values: [nextRow] }
  });
}

function buildHeaderIndex(headerRow: unknown[]): Record<string, number> {
  const index: Record<string, number> = {};

  headerRow.forEach((cell, position) => {
    const header = String(cell ?? "").trim().replace(/\s+/g, " ").toUpperCase();

    if (header && !(header in index)) {
      index[header] = position;
    }
  });

  return index;
}

export class OrderSheetError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OrderSheetError";
    this.status = status;
  }
}

export async function readProductRows() {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);

  return readProductRowsWithClient(sheets, env);
}

export async function appendProductRow(product: AdminProductInput) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);
  await appendProductRowWithClient(sheets, env, product);
}

export async function updateProductRow(
  productId: string,
  product: AdminProductInput
) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);
  await updateProductRowWithClient(sheets, env, productId, product);
}

export async function deleteProductRow(productId: string) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);
  await deleteProductRowWithClient(sheets, env, productId);
}

export async function appendProductRowWithClient(
  sheets: SheetsClient,
  env: Pick<GoogleSheetsEnv, "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_PRODUCTS_RANGE">,
  product: AdminProductInput
) {
  const rows = await readProductRowsWithClient(sheets, env);
  const headerRow = rows[0] ?? [];
  const productIdIndex = getProductHeaderMap(headerRow).PRODUCT_ID;
  const duplicate = rows
    .slice(1)
    .some((row) => String(row[productIdIndex] ?? "").trim() === product.productId);

  if (duplicate) {
    throw new ProductAdminError("PRODUCT_ID already exists.", 409, {
      productId: "PRODUCT_ID already exists."
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    range: env.GOOGLE_PRODUCTS_RANGE,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [productToSheetRow(product, headerRow)] }
  });
}

export async function updateProductRowWithClient(
  sheets: SheetsClient,
  env: Pick<GoogleSheetsEnv, "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_PRODUCTS_RANGE">,
  productId: string,
  product: AdminProductInput
) {
  const rows = await readProductRowsWithClient(sheets, env);
  const headerRow = rows[0] ?? [];
  const productIdIndex = getProductHeaderMap(headerRow).PRODUCT_ID;
  const rowIndex = rows.findIndex(
    (row, index) =>
      index > 0 && String(row[productIdIndex] ?? "").trim() === productId
  );

  if (rowIndex < 1) {
    throw new ProductAdminError("Product was not found.", 404);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    range: getProductRowRange(env.GOOGLE_PRODUCTS_RANGE, rowIndex + 1),
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [productToSheetRow(product, headerRow, rows[rowIndex])]
    }
  });
}

/**
 * Permanently removes one Products row, resolved by PRODUCT_ID.
 *
 * The row number is never taken from the caller: the sheet is re-read and
 * the row is located by its PRODUCT_ID cell immediately before deletion, so
 * a concurrent edit cannot cause the wrong row to be removed. The header row
 * (index 0) is excluded from the search and can never be deleted. Only the
 * Products tab is touched — Orders and OrderItems are untouched.
 */
export async function deleteProductRowWithClient(
  sheets: SheetsClient,
  env: Pick<GoogleSheetsEnv, "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_PRODUCTS_RANGE">,
  productId: string
) {
  const rows = await readProductRowsWithClient(sheets, env);
  const headerRow = rows[0] ?? [];
  const productIdIndex = getProductHeaderMap(headerRow).PRODUCT_ID;
  const matchingRowIndexes = rows.flatMap((row, index) =>
    index > 0 && String(row[productIdIndex] ?? "").trim() === productId
      ? [index]
      : []
  );

  if (matchingRowIndexes.length === 0) {
    throw new ProductAdminError("Product was not found.", 404);
  }

  // Refuse to guess which duplicate is the real one — deleting the wrong
  // row is unrecoverable. The admin fixes the catalog first.
  if (matchingRowIndexes.length > 1) {
    throw new ProductAdminError(
      "This product ID appears more than once in the catalog, so it was not deleted. Remove the duplicate entry first.",
      409,
      { productId: "Duplicate product ID in the catalog." }
    );
  }

  const spreadsheetId = env.GOOGLE_ORDER_SPREADSHEET_ID;
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)"
  });
  const productsSheetId = getSheetIdByTitle(
    spreadsheet.data.sheets,
    getSheetNameFromRange(env.GOOGLE_PRODUCTS_RANGE)
  );
  // GOOGLE_PRODUCTS_RANGE is column-only notation (see getProductRowRange),
  // so range index N is sheet row N + 1, i.e. zero-based dimension index N.
  const startIndex = matchingRowIndexes[0];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: productsSheetId,
              dimension: "ROWS",
              startIndex,
              endIndex: startIndex + 1
            }
          }
        }
      ]
    }
  });
}

export async function readProductRowsWithClient(
  sheets: SheetsClient,
  env: Pick<
    GoogleSheetsEnv,
    "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_PRODUCTS_RANGE"
  >
) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_ORDER_SPREADSHEET_ID,
    range: env.GOOGLE_PRODUCTS_RANGE
  });

  return response.data.values ?? [];
}

export async function appendRowsWithClient(
  sheets: SheetsClient,
  env: Pick<
    GoogleSheetsEnv,
    "GOOGLE_ORDER_SPREADSHEET_ID" | "GOOGLE_ORDERS_RANGE" | "GOOGLE_ORDER_ITEMS_RANGE"
  >,
  rows: OrderSheetRows,
  sheetIds?: OrderSheetIds
) {
  const spreadsheetId = env.GOOGLE_ORDER_SPREADSHEET_ID;
  const { ordersSheetId, orderItemsSheetId } =
    sheetIds ?? (await resolveOrderSheetIds(sheets, env));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          appendCells: {
            sheetId: ordersSheetId,
            rows: [toRowData(rows.ordersRow)],
            fields: "userEnteredValue"
          }
        },
        {
          appendCells: {
            sheetId: orderItemsSheetId,
            rows: rows.orderItemsRows.map(toRowData),
            fields: "userEnteredValue"
          }
        }
      ]
    }
  });
}

function getAuthenticatedSheetsClient(env: GoogleSheetsEnv) {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

function getSheetNameFromRange(range: string) {
  const [sheetName] = range.split("!");

  return sheetName.replace(/^'/, "").replace(/'$/, "");
}

function getProductRowRange(range: string, rowNumber: number) {
  return getRowRange(range, rowNumber);
}

function getRowRange(range: string, rowNumber: number) {
  const match = range.match(/^(.*)!\$?([A-Z]+)(?::\$?([A-Z]+))?$/i);

  if (!match) {
    throw new Error("Sheet range must use A:H-style column notation.");
  }

  const [, sheetName, startColumn, endColumn = startColumn] = match;
  return `${sheetName}!${startColumn}${rowNumber}:${endColumn}${rowNumber}`;
}

function getSheetIdByTitle(
  sheets: sheets_v4.Schema$Sheet[] | undefined,
  title: string
) {
  const sheet = sheets?.find((candidate) => candidate.properties?.title === title);
  const sheetId = sheet?.properties?.sheetId;

  if (typeof sheetId !== "number") {
    throw new Error(`Configured Google Sheet tab was not found: ${title}`);
  }

  return sheetId;
}

function toRowData(values: SheetCell[]): sheets_v4.Schema$RowData {
  return {
    values: values.map((value) => ({
      userEnteredValue:
        typeof value === "number"
          ? { numberValue: value }
          : { stringValue: value }
    }))
  };
}
