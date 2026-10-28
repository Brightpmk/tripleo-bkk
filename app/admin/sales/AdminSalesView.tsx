"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { universities, productImagePlaceholder } from "@/lib/catalog";
import { formatThb } from "@/lib/format";
import {
  defaultSalesFilters,
  salesPaymentOptions,
  validateSalesFilters,
  type SalesFilters,
  type SalesProductSummary,
  type SalesSummary
} from "@/lib/sales-summary";

export function AdminSalesView() {
  const [filters, setFilters] = useState<SalesFilters>(defaultSalesFilters);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [showUnsold, setShowUnsold] = useState(true);
  const filterError = validateSalesFilters(filters);

  useEffect(() => {
    if (validateSalesFilters(filters)) return;
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams(filters);
        const response = await fetch(`/api/admin/sales?${query}`, {
          cache: "no-store", signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(response.status === 401
            ? "Your session has expired. Sign in again to view sales."
            : "Sales summary could not be loaded. Please try again.");
        }
        const result = await response.json() as SalesSummary;
        if (!controller.signal.aborted) setSummary(result);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Sales summary could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [filters, revision]);

  function updateFilters(next: SalesFilters) {
    setLoading(true);
    setError("");
    setSummary(null);
    setFilters(next);
  }

  function refresh() {
    setLoading(true);
    setError("");
    setSummary(null);
    setRevision((value) => value + 1);
  }

  const visibleGroups = summary?.groups.map((group) => ({
    ...group, products: group.products.filter((product) => showUnsold || product.units > 0)
  })).filter((group) => group.products.length > 0) ?? [];
  const busy = loading && !filterError;

  return (
    <section className="admin-content admin-sales-content" aria-label="Shirt sales summary">
      <div className="admin-section-head admin-sales-heading">
        <div>
          <h2>Shirts sold by size</h2>
          <p>Cancelled and rejected orders excluded. Dates use Bangkok time.</p>
        </div>
        <div className="admin-sales-tools">
          <button className="admin-button admin-button-secondary admin-sales-icon" type="button"
            title="Reset filters" aria-label="Reset filters" onClick={() => updateFilters({ ...defaultSalesFilters })}>
            <RotateCcw size={18} aria-hidden="true" />
          </button>
          <button className="admin-button admin-button-secondary" type="button" onClick={refresh} disabled={busy || Boolean(filterError)}>
            <RefreshCw size={16} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      <div className="admin-filters admin-sales-filters">
        <label>University
          <select value={filters.university} onChange={(event) => updateFilters({ ...filters, university: event.target.value })}>
            <option value="all">All universities</option>
            {universities.map((university) => <option key={university.id} value={university.sheetValue}>{university.shortName}</option>)}
          </select>
        </label>
        <label>Payment
          <select value={filters.payment} onChange={(event) => updateFilters({ ...filters, payment: event.target.value as SalesFilters["payment"] })}>
            {salesPaymentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>From
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilters({ ...filters, to: event.target.value })} />
        </label>
      </div>

      <label className="admin-sales-toggle">
        <input type="checkbox" checked={showUnsold} onChange={(event) => setShowUnsold(event.target.checked)} />
        Show unsold designs
      </label>

      {(filterError || error) && <p role="alert" className="admin-page-error">{filterError || error}</p>}
      {error && <button className="admin-button admin-button-secondary" type="button" onClick={refresh}>Try again</button>}
      {busy && <p className="admin-sales-status" role="status">Loading sales summary...</p>}

      {!busy && !filterError && !error && summary && <>
        <dl className="admin-sales-metrics" aria-label="Sales totals">
          <div><dt>Shirts sold</dt><dd>{summary.units.toLocaleString()}</dd></div>
          <div><dt>Orders</dt><dd>{summary.orderCount.toLocaleString()}</dd></div>
          <div><dt>Shirt revenue</dt><dd>{formatThb(summary.revenueThb)}</dd></div>
        </dl>
        <div className="admin-sales-results" aria-live="polite">
          {visibleGroups.length === 0 && <p className="admin-sales-empty">No designs match these filters.</p>}
          {visibleGroups.map((group) => (
            <details className="admin-sales-university" key={group.university} open>
              <summary>
                <div className="admin-sales-campus-name"><p>{group.brand}</p><h2>{group.name}</h2></div>
                <div className="admin-sales-campus-totals">
                  <span><strong>{group.units.toLocaleString()}</strong> {group.units === 1 ? "shirt" : "shirts"}</span>
                  <span>{group.orderCount.toLocaleString()} {group.orderCount === 1 ? "order" : "orders"}</span>
                  <span>{formatThb(group.revenueThb)}</span>
                </div>
                <ChevronDown size={20} className="admin-sales-chevron" aria-hidden="true" />
              </summary>
              {group.products.map((product) => (
                <article className="admin-sales-product" key={product.productId} aria-label={`${group.name} ${product.shirtColor} ${product.productId}`}>
                  <div className="admin-sales-product-heading">
                    <SalesProductImage product={product} />
                    <div className="admin-sales-product-name">
                      <h3>{product.shirtColor}</h3>
                      <p>{product.productId}</p>
                      {product.historical ? <small>Historical design</small> : !product.active ? <small>Inactive design</small> : null}
                    </div>
                    <div className="admin-sales-product-total"><strong>{product.units.toLocaleString()} {product.units === 1 ? "shirt" : "shirts"}</strong><span>{formatThb(product.revenueThb)}</span></div>
                  </div>
                  <SizeSalesTable sizes={summary.sizes} quantities={product.quantities} total={product.units} label={`${group.name}: ${product.shirtColor} (${product.productId})`} />
                </article>
              ))}
              <div className="admin-sales-campus-footer">
                <h3>{group.name} total</h3>
                <SizeSalesTable sizes={summary.sizes} quantities={group.quantities} total={group.units} label={`${group.name} total`} />
              </div>
            </details>
          ))}
        </div>
        <p className="admin-sales-updated">Updated {new Date(summary.loadedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} (Bangkok)</p>
      </>}
    </section>
  );
}

function SalesProductImage({ product }: { product: SalesProductSummary }) {
  const [failed, setFailed] = useState(false);
  return <Image className="admin-sales-product-image" src={failed || !product.imageUrl ? productImagePlaceholder : product.imageUrl}
    alt={`${product.shirtColor} ${product.productId}`} width={112} height={80} unoptimized onError={() => setFailed(true)} />;
}

function SizeSalesTable({ sizes, quantities, total, label }: {
  sizes: string[];
  quantities: Record<string, number>;
  total: number;
  label: string;
}) {
  return (
    <div className="admin-sales-table-scroll" tabIndex={0} role="region" aria-label={`${label} size totals`}>
      <table className="admin-sales-size-table">
        <caption className="sr-only">{label}: shirts sold per size</caption>
        <thead><tr><th scope="col">Size</th>{sizes.map((size) => <th scope="col" key={size}>{size}</th>)}<th scope="col" className="admin-sales-total-cell">Total</th></tr></thead>
        <tbody><tr><th scope="row">Sold</th>{sizes.map((size) => <td key={size} className={!quantities[size] ? "admin-sales-zero" : undefined}>{(quantities[size] ?? 0).toLocaleString()}</td>)}<td className="admin-sales-total-cell">{total.toLocaleString()}</td></tr></tbody>
      </table>
    </div>
  );
}
