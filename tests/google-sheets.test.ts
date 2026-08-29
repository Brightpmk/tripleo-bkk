import { describe, expect, it, vi } from "vitest";
import type { OrderSheetRows } from "@/lib/server/order-row-mapper";

vi.mock("server-only", () => ({}));

describe("Google Sheets adapter", () => {
  it("uses one batch update for Orders and OrderItems appends", async () => {
    const { appendRowsWithClient } = await import("@/lib/server/google-sheets");
    type BatchUpdateArgs = {
      requestBody: {
        requests: Array<{
          appendCells: {
            sheetId: number;
          };
        }>;
      };
    };
    const rows: OrderSheetRows = {
      ordersRow: ["KG-2026-A8F2B91C", "2026-08-29T10:00:00.000Z"],
      orderItemsRows: [
        ["KG-2026-A8F2B91C", "KG-2026-A8F2B91C-01"],
        ["KG-2026-A8F2B91C", "KG-2026-A8F2B91C-02"]
      ]
    };
    let batchUpdateArgs: BatchUpdateArgs | undefined;
    const batchUpdate = vi.fn(async (args: BatchUpdateArgs) => {
      batchUpdateArgs = args;
      return {};
    });
    const get = vi.fn(async () => ({
      data: {
        sheets: [
          { properties: { title: "Orders", sheetId: 10 } },
          { properties: { title: "OrderItems", sheetId: 11 } }
        ]
      }
    }));

    await appendRowsWithClient(
      {
        spreadsheets: {
          get,
          batchUpdate
        }
      } as unknown as Parameters<typeof appendRowsWithClient>[0],
      {
        GOOGLE_ORDER_SPREADSHEET_ID: "spreadsheet-id",
        GOOGLE_ORDERS_RANGE: "Orders!A:Q",
        GOOGLE_ORDER_ITEMS_RANGE: "OrderItems!A:H"
      },
      rows
    );

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-id",
      fields: "sheets.properties(sheetId,title)"
    });
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdateArgs?.requestBody.requests).toHaveLength(2);
    expect(batchUpdateArgs?.requestBody.requests[0].appendCells.sheetId).toBe(10);
    expect(batchUpdateArgs?.requestBody.requests[1].appendCells.sheetId).toBe(11);
  });
});
