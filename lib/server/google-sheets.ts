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

export async function appendOrderRows(rows: OrderSheetRows) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);

  await appendRowsWithClient(sheets, env, rows);
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
  rows: OrderSheetRows
) {
  const spreadsheetId = env.GOOGLE_ORDER_SPREADSHEET_ID;
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)"
  });

  const ordersSheetId = getSheetIdByTitle(
    spreadsheet.data.sheets,
    getSheetNameFromRange(env.GOOGLE_ORDERS_RANGE)
  );
  const orderItemsSheetId = getSheetIdByTitle(
    spreadsheet.data.sheets,
    getSheetNameFromRange(env.GOOGLE_ORDER_ITEMS_RANGE)
  );

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
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

function getSheetNameFromRange(range: string) {
  const [sheetName] = range.split("!");

  return sheetName.replace(/^'/, "").replace(/'$/, "");
}

function getProductRowRange(range: string, rowNumber: number) {
  const match = range.match(/^(.*)!\$?([A-Z]+)(?::\$?([A-Z]+))?$/i);

  if (!match) {
    throw new Error("GOOGLE_PRODUCTS_RANGE must use A:H-style column notation.");
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
