import Link from "next/link";
import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getAdminOrderDetail } from "@/lib/server/order-admin-service";
import type { AdminOrderDetail } from "@/lib/orders-admin";
import { AdminShell } from "../../AdminShell";
import { AdminOrderDetailView } from "./AdminOrderDetailView";
import "../../admin.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminOrderDetailPage({
  params
}: {
  params: Promise<{ orderId: string }>;
}) {
  if (!(await hasValidAdminSession())) {
    redirect("/admin/login");
  }

  const { orderId } = await params;
  let order: AdminOrderDetail | null = null;
  let loadError = "";

  try {
    order = await getAdminOrderDetail(orderId);
  } catch (error) {
    console.error("Admin order detail load failed", {
      orderId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    loadError =
      "This order could not be loaded from Supabase. Please try again in a moment.";
  }

  return (
    <AdminShell title="Order">
      {order ? (
        <AdminOrderDetailView order={order} />
      ) : (
        <section className="admin-content">
          {loadError ? (
            <p className="admin-page-error" role="alert">
              {loadError}
            </p>
          ) : (
            <div className="admin-empty-card">
              <h3>Order not found</h3>
              <p>No order matches this ID.</p>
            </div>
          )}
          <p style={{ marginTop: "var(--s-5)" }}>
            <Link className="admin-button admin-button-secondary" href="/admin/orders">
              Back to orders
            </Link>
          </p>
        </section>
      )}
    </AdminShell>
  );
}
