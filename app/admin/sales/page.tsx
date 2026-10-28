import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { AdminShell } from "../AdminShell";
import { AdminSalesView } from "./AdminSalesView";
import "../admin.css";
import "./sales.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminSalesPage() {
  if (!(await hasValidAdminSession())) redirect("/admin/login");
  return <AdminShell title="Sales Summary"><AdminSalesView /></AdminShell>;
}
