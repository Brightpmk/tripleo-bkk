import { describe, expect, it, vi } from "vitest";
import type { OrderSheetRows } from "@/lib/server/order-row-mapper";
import type { AdminProduct } from "@/lib/admin-products";

vi.mock("server-only", () => ({}));

describe("Google Sheets adapter", () => {
  const productHeader = [
    "PRODUCT_ID",
    "UNIVERSITY",
    "JERSEY_COLOR",
    "PRICE",
    "IMAGE_URL",
    "AVAILABLE_SIZES",
    "ACTIVE",
    "SORT_ORDER"
  ];
  const product: AdminProduct = {
    productId: "kg-bm-matcha",
    university: "BANGMOD",
    jerseyColor: "Matcha",
    priceThb: 450,
    imageUrl: "https://store.public.blob.vercel-storage.com/matcha.png",
    availableSizes: ["S", "M"],
    active: true,
    sortOrder: 2
  };

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

  it("reads product rows from the configured Products range", async () => {
    const { readProductRowsWithClient } = await import("@/lib/server/google-sheets");
    const values = [["PRODUCT_ID"], ["kg-bm-matcha"]];
    const get = vi.fn(async () => ({
      data: {
        values
      }
    }));

    const result = await readProductRowsWithClient(
      {
        spreadsheets: {
          values: {
            get
          }
        }
      } as unknown as Parameters<typeof readProductRowsWithClient>[0],
      {
        GOOGLE_ORDER_SPREADSHEET_ID: "spreadsheet-id",
        GOOGLE_PRODUCTS_RANGE: "'Products'!A:H"
      }
    );

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-id",
      range: "'Products'!A:H"
    });
    expect(result).toBe(values);
  });

  it("appends a product without replacing the Products sheet", async () => {
    const { appendProductRowWithClient } = await import(
      "@/lib/server/google-sheets"
    );
    const append = vi.fn(async () => ({}));
    const get = vi.fn(async () => ({ data: { values: [productHeader] } }));

    await appendProductRowWithClient(
      {
        spreadsheets: { values: { get, append } }
      } as unknown as Parameters<typeof appendProductRowWithClient>[0],
      {
        GOOGLE_ORDER_SPREADSHEET_ID: "spreadsheet-id",
        GOOGLE_PRODUCTS_RANGE: "'Products'!A:H"
      },
      product
    );

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Products'!A:H",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            "kg-bm-matcha",
            "BANGMOD",
            "Matcha",
            450,
            product.imageUrl,
            "S,M",
            "TRUE",
            2
          ]]
        }
      })
    );
  });

  it("updates only the row resolved by PRODUCT_ID", async () => {
    const { updateProductRowWithClient } = await import(
      "@/lib/server/google-sheets"
    );
    const update = vi.fn(async () => ({}));
    const get = vi.fn(async () => ({
      data: {
        values: [
          productHeader,
          ["other-id", "LADKRABANG", "Berry", 390, "/berry.svg", "M", "TRUE", 1],
          ["kg-bm-matcha", "BANGMOD", "Old Matcha", 390, "/old.svg", "M", "TRUE", 4]
        ]
      }
    }));

    await updateProductRowWithClient(
      {
        spreadsheets: { values: { get, update } }
      } as unknown as Parameters<typeof updateProductRowWithClient>[0],
      {
        GOOGLE_ORDER_SPREADSHEET_ID: "spreadsheet-id",
        GOOGLE_PRODUCTS_RANGE: "'Products'!A:H"
      },
      "kg-bm-matcha",
      { ...product, active: false, priceThb: 525 }
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'Products'!A3:H3",
        requestBody: {
          values: [[
            "kg-bm-matcha",
            "BANGMOD",
            "Matcha",
            525,
            product.imageUrl,
            "S,M",
            "FALSE",
            2
          ]]
        }
      })
    );
  });
});
