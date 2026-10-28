import "server-only";

import { buildSalesSummary, type SalesFilters } from "@/lib/sales-summary";
import { readAdminDataTable } from "./admin-data";

export async function getSalesSummary(filters: SalesFilters) {
  const [orders, items, products] = await Promise.all([
    readAdminDataTable("orders"), readAdminDataTable("order_items"), readAdminDataTable("products")
  ]);
  return buildSalesSummary({
    orders: orders.map((row) => ({
      orderId: String(row.order_id), university: String(row.university),
      createdAt: String(row.created_at), paymentStatus: String(row.payment_status), orderStatus: String(row.order_status)
    })),
    items: items.map((row) => ({
      orderId: String(row.order_id), productId: String(row.product_id), shirtColor: String(row.shirt_color),
      size: String(row.size), quantity: Number(row.quantity), lineTotalThb: Number(row.line_total_thb)
    })),
    products: products.map((row) => ({
      productId: String(row.product_id), university: String(row.university), shirtColor: String(row.shirt_color),
      imageUrl: String(row.image_url ?? ""), availableSizes: String(row.available_sizes ?? "").split(", ").filter(Boolean),
      active: row.active === true, sortOrder: Number(row.sort_order)
    }))
  }, filters);
}
