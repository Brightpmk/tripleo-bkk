"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, RefreshCw, Search, Table2 } from "lucide-react";
import { dataTableIds, dataTables, displayDataCell, selectDataRows, type AdminDataSnapshot, type DataTableId } from "@/lib/admin-data";

export function AdminDataView() {
  const [snapshot, setSnapshot] = useState<AdminDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [tableId, setTableId] = useState<DataTableId>("orders");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "created_at", direction: "desc" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/data", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401
          ? "Your session has expired. Sign in again to view data."
          : "Data could not be loaded. Please try again.");
        const next = await response.json() as AdminDataSnapshot;
        if (!controller.signal.aborted) setSnapshot(next);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Data could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  const table = dataTables[tableId];
  const rows = useMemo(() => selectDataRows(snapshot?.tables[tableId] ?? [], table.columns, search, sort), [snapshot, tableId, table.columns, search, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(offset, offset + pageSize);
  const totalRows = snapshot?.tables[tableId].length ?? 0;

  function refresh() {
    setLoading(true);
    setError("");
    setRevision((value) => value + 1);
  }

  async function exportAll() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/admin/data/export", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401
        ? "Your session has expired. Sign in again to export."
        : "Export could not be completed. Please try again.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "tripleo-data.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : "Export could not be completed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="admin-content admin-data-content">
      <div className="admin-data-toolbar">
        <div className="admin-data-title"><Table2 size={20} aria-hidden="true" /><h2>All records</h2></div>
        <div className="admin-data-actions">
          <button className="admin-button admin-button-secondary admin-data-icon" title="Refresh data" aria-label="Refresh data" disabled={loading} onClick={refresh}>
            <RefreshCw size={18} className={loading ? "admin-data-spinning" : ""} aria-hidden="true" />
          </button>
          <button className="admin-button admin-button-primary" onClick={exportAll} disabled={exporting}>
            <Download size={18} aria-hidden="true" />{exporting ? "Exporting..." : "Export all .xlsx"}
          </button>
        </div>
      </div>

      {exportError && <p role="alert" className="admin-page-error">{exportError}</p>}
      {error && <p role="alert" className="admin-page-error">{error} <button className="admin-button admin-button-secondary" onClick={refresh} disabled={loading}>Retry</button></p>}

      <div className="admin-data-tabs" role="tablist" aria-label="Data worksheets">
        {dataTableIds.map((id, index) => (
          <button key={id} id={`data-tab-${id}`} role="tab" aria-selected={tableId === id} aria-controls="data-panel"
            tabIndex={tableId === id ? 0 : -1}
            onKeyDown={(event) => {
              const next = event.key === "ArrowRight" ? (index + 1) % dataTableIds.length
                : event.key === "ArrowLeft" ? (index + dataTableIds.length - 1) % dataTableIds.length
                : event.key === "Home" ? 0 : event.key === "End" ? dataTableIds.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              document.getElementById(`data-tab-${dataTableIds[next]}`)?.click();
              document.getElementById(`data-tab-${dataTableIds[next]}`)?.focus();
            }}
            onClick={() => {
              setTableId(id); setSearch(""); setPage(1);
              setSort({ key: id === "orders" ? "created_at" : dataTables[id].columns[0].key, direction: id === "orders" ? "desc" : "asc" });
            }}>
            {dataTables[id].label}<span>{snapshot ? snapshot.tables[id].length.toLocaleString() : "-"}</span>
          </button>
        ))}
      </div>

      <div id="data-panel" role="tabpanel" aria-labelledby={`data-tab-${tableId}`} aria-busy={loading}>
        <div className="admin-data-filters">
          <label className="admin-data-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={`Search ${table.label}`} placeholder={`Search ${table.label.toLowerCase()}`} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label className="admin-data-page-size">Rows<select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select></label>
        </div>
        {loading && <p className="admin-data-status" role="status">Loading records...</p>}
        {!loading && snapshot && <>
          <div className="admin-data-grid" key={tableId} tabIndex={0} role="region" aria-label={`${table.label} table`}>
            <table>
              <caption className="sr-only">{table.label}</caption>
              <thead><tr><th scope="col" className="admin-data-row-number">#</th>{table.columns.map((column) => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
                <button onClick={() => { setSort({ key: column.key, direction: sort.key === column.key && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); }}>
                  {column.label}{sort.key === column.key ? sort.direction === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" /> : <ArrowUpDown size={14} aria-hidden="true" />}
                </button>
              </th>)}</tr></thead>
              <tbody>{pageRows.length ? pageRows.map((row, index) => <tr key={String(row.id)}>
                <th scope="row" className="admin-data-row-number">{offset + index + 1}</th>
                {table.columns.map((column) => <td key={column.key} className={column.kind === "number" ? "admin-data-numeric" : undefined}>
                  <div style={{ width: `${column.width ?? 20}ch` }}>{displayDataCell(row[column.key], column)}</div>
                </td>)}
              </tr>) : <tr><td colSpan={table.columns.length + 1} className="admin-data-empty">{search ? "No matching records." : "No records yet."}</td></tr>}</tbody>
            </table>
          </div>
          <div className="admin-data-pagination">
            <p role="status">{rows.length ? `${offset + 1}-${Math.min(offset + pageSize, rows.length)}` : "0"} of {rows.length.toLocaleString()} rows{search ? ` (${totalRows.toLocaleString()} total)` : ""}</p>
            <div className="admin-data-page-controls">
              <button className="admin-button admin-button-secondary admin-data-icon" title="Previous page" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
              <span>{currentPage} / {pageCount}</span>
              <button className="admin-button admin-button-secondary admin-data-icon" title="Next page" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </div>
          <p className="admin-data-updated">Updated {new Date(snapshot.loadedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} (Bangkok)</p>
        </>}
      </div>
    </section>
  );
}
