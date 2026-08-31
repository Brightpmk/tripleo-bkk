import "server-only";

import type {
  AdminOrderDetail,
  AdminOrderItem,
  AdminOrderPatch
} from "@/lib/orders-admin";
import { getUniversityBySheetValue } from "@/lib/orders-admin";
import {
  getSupabaseServiceClient,
  type SupabaseOrderItemRow,
  type SupabaseOrderRow
} from "./client";

export async function listSupabaseOrders(): Promise<AdminOrderDetail[]> {
  const supabase = getSupabaseServiceClient();
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (ordersError) {
    throw ordersError;
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .order("item_id", { ascending: true });

  if (itemsError) {
    throw itemsError;
  }

  const itemsByOrderId = new Map<string, AdminOrderItem[]>();

  for (const item of (items ?? []) as SupabaseOrderItemRow[]) {
    const orderItems = itemsByOrderId.get(item.order_id) ?? [];
    orderItems.push({
      itemId: item.item_id,
      productId: item.product_id,
      shirtColor: item.shirt_color,
      size: item.size,
      quantity: item.quantity,
      unitPriceThb: item.unit_price_thb,
      lineTotalThb: item.line_total_thb
    });
    itemsByOrderId.set(item.order_id, orderItems);
  }

  return ((orders ?? []) as SupabaseOrderRow[]).map((order) => {
    const university = getUniversityBySheetValue(order.university);
    const orderItems = itemsByOrderId.get(order.order_id) ?? [];

    return {
      orderId: order.order_id,
      createdAtIso: order.created_at,
      universityId: university?.id ?? null,
      universityLabel: university?.brand ?? order.university,
      customerName: order.full_name,
      phone: order.phone,
      deliveryMethod: order.delivery_method,
      itemCount: orderItems.reduce((count, item) => count + item.quantity, 0),
      subtotalThb: order.subtotal_thb,
      shippingFeeThb: order.shipping_fee_thb,
      totalThb: order.total_thb,
      paymentStatus: order.payment_status,
      orderStatus: order.order_status,
      shippingProvider: order.shipping_provider ?? "",
      trackingNumber: order.tracking_number ?? "",
      hasSlip: Boolean(order.slip_file_id),
      shippingAddress: order.shipping_address ?? "",
      notes: order.notes ?? "",
      items: orderItems,
      dataIssues: orderItems.length === 0 ? ["No order items found"] : []
    };
  });
}

export async function updateSupabaseOrder(
  orderId: string,
  patch: AdminOrderPatch
) {
  const supabase = getSupabaseServiceClient();
  const update = {
    ...(patch.paymentStatus !== undefined
      ? { payment_status: patch.paymentStatus }
      : {}),
    ...(patch.orderStatus !== undefined ? { order_status: patch.orderStatus } : {}),
    ...(patch.shippingProvider !== undefined
      ? { shipping_provider: patch.shippingProvider }
      : {}),
    ...(patch.trackingNumber !== undefined
      ? { tracking_number: patch.trackingNumber }
      : {})
  };

  if (Object.keys(update).length === 0) {
    return;
  }

  const { error } = await supabase
    .from("orders")
    .update(update)
    .eq("order_id", orderId);

  if (error) {
    throw error;
  }
}
