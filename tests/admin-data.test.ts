import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { dataTables, selectDataRows, type AdminDataSnapshot, type DataRow } from "@/lib/admin-data";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/server/supabase/client", () => ({ getSupabaseServiceClient: mocks.client }));
import { readAdminDataTable } from "@/lib/server/admin-data";
import { createAdminDataWorkbook } from "@/lib/server/admin-data-workbook";

beforeEach(() => vi.clearAllMocks());

function queryBatches(batches: Array<{ data: Record<string, unknown>[] | null; error: { code: string } | null }>) {
  let index = 0;
  const query = {
    select: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query), gt: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(batches[index++]).then(resolve)
  };
  mocks.client.mockReturnValue({ from: vi.fn(() => query) });
  return query;
}

describe("admin data reader", () => {
  it("continues after short API batches and excludes private storage references", async () => {
    const query = queryBatches([
      { data: [{ id: "a", order_id: "KG-A", slip_file_id: "private-slip-path", full_name_search: "internal" }], error: null },
      { data: [{ id: "b", order_id: "KG-B", slip_file_id: null }], error: null },
      { data: [], error: null }
    ]);
    const rows = await readAdminDataTable("orders");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.slip_uploaded)).toEqual([true, false]);
    expect(query.gt.mock.calls).toEqual([["id", "a"], ["id", "b"]]);
    expect(JSON.stringify(rows)).not.toContain("private-slip-path");
    expect(rows[0]).not.toHaveProperty("full_name_search");
  });

  it("loads more than 1,000 rows without truncating the export", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(index).padStart(5, "0"), quantity: 1 }));
    queryBatches([
      { data: rows.slice(0, 500), error: null }, { data: rows.slice(500, 1000), error: null },
      { data: rows.slice(1000), error: null }, { data: [], error: null }
    ]);
    const result = await readAdminDataTable("order_items");
    expect(result).toHaveLength(1001);
    expect(new Set(result.map((row) => row.id)).size).toBe(1001);
  });

  it("fails the whole read when a later batch fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    queryBatches([{ data: [{ id: "a" }], error: null }, { data: null, error: { code: "42501" } }]);
    await expect(readAdminDataTable("orders")).rejects.toThrow("Data could not be loaded");
    expect(log).toHaveBeenCalledWith("Admin data read failed", { operation: "admin-data-read", table: "orders", code: "42501" });
    log.mockRestore();
  });
});

describe("admin workbook", () => {
  it("round-trips four sheets, literal customer input, numeric amounts, booleans and dates", async () => {
    const row = Object.fromEntries(dataTables.orders.columns.map((column) => [column.key, null])) as DataRow;
    Object.assign(row, {
      id: "a", order_id: "KG-2026-TEST1234", phone: "0812345678", full_name: "=HYPERLINK(\"https://example.com\")",
      shipping_address: "\u0e01\u0e23\u0e38\u0e07\u0e40\u0e17\u0e1e\n123 Test Road", total_thb: 259, slip_uploaded: true,
      created_at: "2026-10-27T03:10:00.000Z", payment_status: "pending", tracking_number: "001234567890"
    });
    const snapshot: AdminDataSnapshot = { loadedAt: "2026-10-27T04:00:00Z", tables: { orders: [row], order_items: [], products: [], product_images: [] } };
    const bytes = await createAdminDataWorkbook(snapshot);
    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(bytes);
    expect(parsed.worksheets.map((sheet) => sheet.name)).toEqual(["Orders", "Order Items", "Products", "Product Images"]);
    const sheet = parsed.getWorksheet("Orders")!;
    const cell = (key: string) => sheet.getCell(2, dataTables.orders.columns.findIndex((column) => column.key === key) + 1);
    expect(cell("phone").value).toBe("0812345678");
    expect(cell("tracking_number").value).toBe("001234567890");
    expect(cell("full_name").value).toBe(row.full_name);
    expect(cell("full_name").type).toBe(ExcelJS.ValueType.String);
    expect(cell("shipping_address").value).toBe(row.shipping_address);
    expect(cell("total_thb").value).toBe(259);
    expect(cell("slip_uploaded").value).toBe(true);
    expect(cell("created_at").value).toEqual(new Date("2026-10-27T03:10:00Z"));
    expect(cell("notes").value).toBeNull();
    expect(sheet.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(parsed.getWorksheet("Products")!.rowCount).toBe(1);
  });
});

describe("grid search and sorting", () => {
  it("sorts amounts numerically and searches all displayed columns without mutating source data", () => {
    const rows: DataRow[] = [{ total_thb: 100, full_name: "Ada", phone: "0812345678" }, { total_thb: 20, full_name: "Bea", phone: "0898765432" }];
    expect(selectDataRows(rows, dataTables.orders.columns, "", { key: "total_thb", direction: "asc" }).map((row) => row.total_thb)).toEqual([20, 100]);
    expect(rows[0].total_thb).toBe(100);
    expect(selectDataRows(rows, dataTables.orders.columns, "081234", { key: "total_thb", direction: "asc" })).toEqual([rows[0]]);
  });
});
