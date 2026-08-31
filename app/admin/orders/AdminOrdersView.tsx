"use client";

import { useMemo, useState } from "react";
import { universities } from "@/lib/catalog";
import type { UniversityId } from "@/lib/catalog";
import type { PaymentStatus } from "@/lib/orders";
import type { DeliveryMethod } from "@/lib/pricing";
import {
  defaultAdminOrderFilters,
  filterAdminOrders,
  orderStatuses,
  orderStatusLabels,
  paymentStatuses,
  paymentStatusLabels,
  sortAdminOrders,
  type AdminOrderFilters,
  type AdminOrderSort,
  type AdminOrderStatus,
  type AdminOrderSummary
} from "@/lib/orders-admin";
import { AdminOrderRow } from "./AdminOrderPresenters";

const PAGE_SIZE = 25;

const sortLabels: Record<AdminOrderSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  highest: "Highest total",
  lowest: "Lowest total"
};

export function AdminOrdersView({
  orders,
  loadError
}: {
  orders: AdminOrderSummary[];
  loadError: string;
}) {
  const [filters, setFilters] = useState<AdminOrderFilters>(
    defaultAdminOrderFilters
  );
  const [sort, setSort] = useState<AdminOrderSort>("newest");
  const [page, setPage] = useState(1);

  const visible = useMemo(
    () => sortAdminOrders(filterAdminOrders(orders, filters), sort),
    [orders, filters, sort]
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageOrders = visible.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  function update<K extends keyof AdminOrderFilters>(
    key: K,
    value: AdminOrderFilters[K]
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const filtersActive =
    filters.search !== "" ||
    filters.paymentStatus !== "ALL" ||
    filters.orderStatus !== "ALL" ||
    filters.deliveryMethod !== "ALL" ||
    filters.universityId !== "ALL";

  return (
    <section className="admin-content">
      <div className="admin-section-head">
        <div>
          <h2>All orders</h2>
          <p>
            {orders.length} order{orders.length === 1 ? "" : "s"} in Supabase
          </p>
        </div>
      </div>

      {loadError ? (
        <p className="admin-page-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="admin-filters admin-filters-orders">
        <label htmlFor="order-search">
          Search
          <input
            id="order-search"
            type="search"
            inputMode="search"
            placeholder="Order ID, name, or phone"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
          />
        </label>

        <label htmlFor="order-payment">
          Payment
          <select
            id="order-payment"
            value={filters.paymentStatus}
            onChange={(event) =>
              update(
                "paymentStatus",
                event.target.value as PaymentStatus | "ALL"
              )
            }
          >
            <option value="ALL">All payments</option>
            {paymentStatuses.map((status) => (
              <option key={status} value={status}>
                {paymentStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="order-status">
          Order status
          <select
            id="order-status"
            value={filters.orderStatus}
            onChange={(event) =>
              update(
                "orderStatus",
                event.target.value as AdminOrderStatus | "ALL"
              )
            }
          >
            <option value="ALL">All statuses</option>
            {orderStatuses.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="order-delivery">
          Delivery
          <select
            id="order-delivery"
            value={filters.deliveryMethod}
            onChange={(event) =>
              update(
                "deliveryMethod",
                event.target.value as DeliveryMethod | "ALL"
              )
            }
          >
            <option value="ALL">All methods</option>
            <option value="pickup">Pickup</option>
            <option value="shipping">Shipping</option>
          </select>
        </label>

        <label htmlFor="order-university">
          University
          <select
            id="order-university"
            value={filters.universityId}
            onChange={(event) =>
              update("universityId", event.target.value as UniversityId | "ALL")
            }
          >
            <option value="ALL">All universities</option>
            {universities.map((university) => (
              <option key={university.id} value={university.id}>
                {university.brand}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="order-sort">
          Sort
          <select
            id="order-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as AdminOrderSort)}
          >
            {(Object.keys(sortLabels) as AdminOrderSort[]).map((option) => (
              <option key={option} value={option}>
                {sortLabels[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="admin-list-meta">
        <p className="admin-result-count" role="status">
          Showing {pageOrders.length} of {visible.length}
          {visible.length !== orders.length ? ` (${orders.length} total)` : ""}
        </p>
        {filtersActive ? (
          <button
            className="admin-button admin-button-secondary admin-button-sm"
            type="button"
            onClick={() => {
              setFilters(defaultAdminOrderFilters);
              setPage(1);
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {!loadError && orders.length === 0 ? (
        <div className="admin-empty-card">
          <h3>No orders yet</h3>
          <p>Orders will appear here as soon as the first one is placed.</p>
        </div>
      ) : null}

      {!loadError && orders.length > 0 && visible.length === 0 ? (
        <div className="admin-empty-card">
          <h3>No matching orders</h3>
          <p>Try a different search term or clear the filters.</p>
        </div>
      ) : null}

      {pageOrders.length > 0 ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-order-table" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Order</th>
                  <th role="columnheader" scope="col">Placed</th>
                  <th role="columnheader" scope="col">Customer</th>
                  <th role="columnheader" scope="col">Items</th>
                  <th role="columnheader" scope="col">Total</th>
                  <th role="columnheader" scope="col">Payment</th>
                  <th role="columnheader" scope="col">Delivery</th>
                  <th role="columnheader" scope="col">Status</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {pageOrders.map((order) => (
                  <AdminOrderRow key={order.orderId} order={order} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 ? (
            <div className="admin-pagination">
              <button
                className="admin-button admin-button-secondary"
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span className="admin-pagination-label" role="status">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="admin-button admin-button-secondary"
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
