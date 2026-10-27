import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { AdminShell } from "../AdminShell";
import { AdminDataView } from "./AdminDataView";
import "../admin.css";
import "./data.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminDataPage() {
  if (!(await hasValidAdminSession())) redirect("/admin/login");
  return <AdminShell title="Data"><AdminDataView /></AdminShell>;
}
