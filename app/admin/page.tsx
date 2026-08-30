import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import {
  listAdminProducts,
  ProductAdminError
} from "@/lib/server/product-admin";
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
    console.error("Admin product list failed", getAdminErrorDiagnostics(error));
    loadError = "Products could not be loaded. Please try again.";
  }

  return <AdminProductsManager initialProducts={products} loadError={loadError} />;
}

function getAdminErrorDiagnostics(error: unknown) {
  const errorName = error instanceof Error ? error.name : "UnknownError";

  if (error instanceof ProductAdminError) {
    return {
      errorName,
      message: error.message,
      status: error.status,
      fieldErrorKeys: Object.keys(error.fieldErrors)
    };
  }

  if (
    error instanceof Error &&
    error.message.startsWith("Missing required server environment variables:")
  ) {
    return { errorName, message: error.message };
  }

  return { errorName };
}
