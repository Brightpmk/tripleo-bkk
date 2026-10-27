import "server-only";

import { dataTableIds, dataTables, type AdminDataSnapshot, type DataCell, type DataRow, type DataTableId } from "@/lib/admin-data";
import { getSupabaseServiceClient } from "./supabase/client";

export async function readAdminDataTable(table: DataTableId): Promise<DataRow[]> {
  const client = getSupabaseServiceClient();
  const columns = dataTables[table].columns;
  const selection = columns.map(({ key }) => key === "slip_uploaded" ? "slip_file_id" : key).join(",");
  const rows: DataRow[] = [];
  let cursor: string | undefined;

  // Keyset paging avoids the API row cap and offset shifts when rows are deleted.
  for (;;) {
    let query = client.from(table).select(selection).order("id", { ascending: true }).limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error || !data) {
      console.error("Admin data read failed", { operation: "admin-data-read", table, code: error?.code });
      throw new Error("Data could not be loaded. Please try again.");
    }
    const batch = data as unknown as Record<string, unknown>[];
    if (!batch.length) break;

    for (const raw of batch) {
      const row: DataRow = {};
      for (const { key } of columns) {
        const value = key === "slip_uploaded" ? Boolean(raw.slip_file_id) : raw[key];
        row[key] = Array.isArray(value)
          ? value.join(", ")
          : value == null ? null : value as DataCell;
      }
      rows.push(row);
    }
    const nextCursor = batch[batch.length - 1].id;
    if (typeof nextCursor !== "string" || nextCursor === cursor) {
      throw new Error("Data could not be loaded. Please try again.");
    }
    cursor = nextCursor;
  }
  return rows;
}

export async function getAdminDataSnapshot(): Promise<AdminDataSnapshot> {
  const entries = await Promise.all(dataTableIds.map(async (id) => [id, await readAdminDataTable(id)] as const));
  return {
    loadedAt: new Date().toISOString(),
    tables: Object.fromEntries(entries) as AdminDataSnapshot["tables"]
  };
}
