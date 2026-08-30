import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getAdminDashboard } from "@/lib/server/order-admin-service";
import type { AdminDashboardData } from "@/lib/server/order-admin-service";
import { AdminShell } from "./AdminShell";
import { AdminOrderRow } from "./orders/AdminOrderPresenters";
import { formatThb } from "@/lib/format";
import "./admin.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminDashboardPage() {
  if (!(await hasValidAdminSession())) {
    redirect("/admin/login");
  }

  let dashboard: AdminDashboardData | null = null;
  let loadError = "";

  try {
    dashboard = await getAdminDashboard();
  } catch (error) {
    console.error("Admin dashboard load failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    loadError =
      "Orders could not be loaded from Google Sheets. Please try again in a moment.";
  }

  return (
    <AdminShell title="Dashboard">
      <section className="admin-content">
        {loadError ? (
          <p className="admin-page-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {dashboard ? (
          <>
            <div className="admin-section-head">
              <div>
                <h2>Today at a glance</h2>
                <p>
                  Figures use Bangkok time. Cancelled orders and rejected
                  payments are excluded from revenue.
                </p>
              </div>
            </div>

            <div className="stat-grid">
              <Stat label="Orders today" value={dashboard.metrics.ordersToday} />
              <Stat
                label="Revenue today"
                value={formatThb(dashboard.metrics.revenueTodayThb)}
              />
              <Stat
                label="Pending payments"
                value={dashboard.metrics.pendingPayments}
                tone={dashboard.metrics.pendingPayments > 0 ? "warn" : "neutral"}
              />
              <Stat
                label="Awaiting fulfilment"
                value={dashboard.metrics.awaitingFulfillment}
                tone={
                  dashboard.metrics.awaitingFulfillment > 0 ? "info" : "neutral"
                }
              />
              <Stat label="Paid orders" value={dashboard.metrics.paidOrders} />
              <Stat label="Shipped" value={dashboard.metrics.shippedOrders} />
              <Stat label="Total orders" value={dashboard.metrics.totalOrders} />
              <Stat
                label="Total revenue"
                value={formatThb(dashboard.metrics.totalRevenueThb)}
              />
            </div>

            <div className="admin-section-head" style={{ marginTop: "var(--s-8)" }}>
              <div>
                <h2>Recent orders</h2>
                <p>The eight most recent orders.</p>
              </div>
              <Link className="admin-button admin-button-secondary" href="/admin/orders">
                View all orders
              </Link>
            </div>

            {dashboard.recentOrders.length === 0 ? (
              <div className="admin-empty-card">
                <h3>No orders yet</h3>
                <p>Orders will appear here as soon as the first one is placed.</p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-order-table" role="table">
                  <thead role="rowgroup">
                    <tr role="row">
                      <th role="columnheader" scope="col">Order</th>
                      <th role="columnheader" scope="col">Placed</th>
                      <th role="columnheader" scope="col">Customer</th>
                      <th role="columnheader" scope="col">Total</th>
                      <th role="columnheader" scope="col">Payment</th>
                      <th role="columnheader" scope="col">Delivery</th>
                      <th role="columnheader" scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {dashboard.recentOrders.map((order) => (
                      <AdminOrderRow key={order.orderId} order={order} compact />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warn" | "info";
}) {
  return (
    <div className={`stat-card${tone !== "neutral" ? ` is-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

