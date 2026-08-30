import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getAdminOrderSummaries } from "@/lib/server/order-admin-service";
import type { AdminOrderSummary } from "@/lib/orders-admin";
import { AdminShell } from "../AdminShell";
import { AdminOrdersView } from "./AdminOrdersView";
import "../admin.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminOrdersPage() {
  if (!(await hasValidAdminSession())) {
    redirect("/admin/login");
  }

  let orders: AdminOrderSummary[] = [];
  let loadError = "";

  try {
    // Summaries only — shipping address, notes, and line items stay on the
    // detail endpoint rather than being shipped to every list render.
    orders = await getAdminOrderSummaries();
  } catch (error) {
    console.error("Admin orders load failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    loadError =
      "Orders could not be loaded from Google Sheets. Please try again in a moment.";
  }

  return (
    <AdminShell title="Orders">
      <AdminOrdersView orders={orders} loadError={loadError} />
    </AdminShell>
  );
}
