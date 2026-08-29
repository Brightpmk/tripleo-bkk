import "server-only";

import { google, type sheets_v4 } from "googleapis";
import {
  getGoogleSheetsEnv,
  normalizePrivateKey,
  type GoogleSheetsEnv
} from "./env";
import type { OrderSheetRows, SheetCell } from "./order-row-mapper";

export type SheetsClient = sheets_v4.Sheets;

export async function appendOrderRows(rows: OrderSheetRows) {
  const env = getGoogleSheetsEnv();
  const sheets = getAuthenticatedSheetsClient(env);

  await appendRowsWithClient(sheets, env, rows);
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
