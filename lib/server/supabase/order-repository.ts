import "server-only";

import type { ConfirmedOrder } from "@/lib/orders";
import type {
  AdminOrderDetail,
  AdminOrderItem,
  AdminOrderPatch
} from "@/lib/orders-admin";
import { getUniversityBySheetValue } from "@/lib/orders-admin";
import { getUniversityById } from "@/lib/catalog";
import type { TrackingSearchMode } from "@/lib/tracking";
import { OrderAdminError } from "../order-admin-error";
import type { AdminOrderRepository } from "../order-repository";
import {
  getSupabaseServiceClient,
  type SupabaseOrderItemRow,
  type SupabaseOrderRow
} from "./client";

export class SupabaseOrderRepository implements AdminOrderRepository {
  async listOrders(): Promise<AdminOrderDetail[]> {
    return listSupabaseOrders();
  }

  async updateOrder(orderId: string, patch: AdminOrderPatch) {
    await updateSupabaseOrder(orderId, patch);
  }

  async getSlipFileId(orderId: string) {
    return getSupabaseOrderSlipFileId(orderId);
  }
}

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

  return mapSupabaseOrders(
    (orders ?? []) as SupabaseOrderRow[],
    (items ?? []) as SupabaseOrderItemRow[]
  );
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

  const { data, error } = await supabase
    .from("orders")
    .update(update)
    .eq("order_id", orderId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new OrderAdminError("Order was not found.", 404);
  }
}

export async function getSupabaseOrderSlipFileId(orderId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("orders")
    .select("slip_file_id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as { slip_file_id: string | null } | null)?.slip_file_id ?? null;
}

export async function createSupabaseOrderWithItems(order: ConfirmedOrder) {
  const university = getUniversityById(order.universityId);

  if (!university) {
    throw new Error("Unsupported university.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("create_order_with_items", {
    p_order: {
      order_id: order.orderId,
      created_at: order.createdAtIso,
      full_name: order.checkout.fullName,
      phone: order.checkout.phone,
      university: university.sheetValue,
      delivery_method: order.checkout.deliveryMethod,
      shipping_address: order.checkout.shippingAddress,
      shipping_fee_thb: order.shippingFeeThb,
      subtotal_thb: order.itemSubtotalThb,
      total_thb: order.finalTotalThb,
      payment_status: order.paymentStatus,
      slip_file_id: order.slipFileId ?? "",
      order_status: "new",
      shipping_provider: "",
      tracking_number: "",
      notes: ""
    },
    p_items: order.items.map((item, index) => ({
      item_id: `${order.orderId}-${String(index + 1).padStart(2, "0")}`,
      product_id: item.productId,
      shirt_color: item.colorName,
      size: item.size,
      quantity: item.quantity,
      unit_price_thb: item.unitPriceThb,
      line_total_thb: item.quantity * item.unitPriceThb
    }))
  });

  if (error) {
    throw error;
  }
}

export async function searchSupabaseTrackingOrders(
  mode: TrackingSearchMode,
  normalizedQuery: string
) {
  const supabase = getSupabaseServiceClient();
  const searchColumn = mode === "name" ? "full_name_search" : "phone_search";
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("*")
    .eq(searchColumn, normalizedQuery)
    .order("created_at", { ascending: false });

  if (ordersError) {
    throw ordersError;
  }

  const orderRows = (orders ?? []) as SupabaseOrderRow[];
  const orderIds = orderRows.map((order) => order.order_id);

  if (orderIds.length === 0) {
    return [];
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .in("order_id", orderIds)
    .order("item_id", { ascending: true });

  if (itemsError) {
    throw itemsError;
  }

  return mapSupabaseOrders(orderRows, (items ?? []) as SupabaseOrderItemRow[]);
}

function mapSupabaseOrders(
  orders: SupabaseOrderRow[],
  items: SupabaseOrderItemRow[]
): AdminOrderDetail[] {
  const itemsByOrderId = groupItemsByOrderId(items);

  return orders.map((order) => {
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

function groupItemsByOrderId(items: SupabaseOrderItemRow[]) {
  const itemsByOrderId = new Map<string, AdminOrderItem[]>();

  for (const item of items) {
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

  return itemsByOrderId;
}
