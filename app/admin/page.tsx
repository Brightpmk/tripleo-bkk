import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { listAdminProducts } from "@/lib/server/product-admin";
import type { AdminProduct } from "@/lib/admin-products";
import { AdminProductsManager } from "./AdminProductsManager";
import "./admin.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminPage() {
  if (!(await hasValidAdminSession())) {
    redirect("/admin/login");
  }

  let products: AdminProduct[] = [];
  let loadError = "";

  try {
    products = await listAdminProducts();
  } catch (error) {
    console.error("Admin product list failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    loadError = "Products could not be loaded. Please try again.";
  }

  return <AdminProductsManager initialProducts={products} loadError={loadError} />;
}
