import "server-only";

import type {
  AdminOrderDetail,
  AdminOrderPatch,
  AdminOrderSummary
} from "@/lib/orders-admin";

/**
 * The storage boundary for admin order workflows.
 *
 * Everything above this interface speaks in AdminOrder* types and knows
 * nothing about the backing store. Supabase is the production runtime store.
 */
export interface AdminOrderRepository {
  /** Full admin snapshot used by the order list, detail page, and dashboard. */
  listOrders(): Promise<AdminOrderDetail[]>;
  updateOrder(orderId: string, patch: AdminOrderPatch): Promise<void>;
  /**
   * Server-only. Deliberately not on AdminOrderDetail so the slip's storage
   * identifier can never be serialised into a client payload.
   */
  getSlipFileId(orderId: string): Promise<string | null>;
  /**
   * Permanently removes the order and its items in one atomic operation,
   * returning the slip reference so the caller can clean up storage after
   * the database has already committed. Null when no order matched.
   */
  deleteOrder(orderId: string): Promise<DeletedOrderRecord | null>;
}

export type DeletedOrderRecord = {
  orderId: string;
  /** Server-only. Never serialised into a client payload. */
  slipFileId: string | null;
  deletedItemCount: number;
};

export function toOrderSummary(order: AdminOrderDetail): AdminOrderSummary {
  const {
    // Stripped: never leaves the detail endpoint.
    shippingAddress: _shippingAddress,
    notes: _notes,
    items: _items,
    ...summary
  } = order;

  return summary;
}
