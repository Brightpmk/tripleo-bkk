import "server-only";

import type {
  AdminOrderDetail,
  AdminOrderItem,
  AdminOrderPatch,
  AdminOrderSummary
} from "@/lib/orders-admin";
import {
  getUniversityBySheetValue,
  parseDeliveryMethod,
  parseOrderStatus,
  parsePaymentStatus,
  toSheetStatus
} from "@/lib/orders-admin";
import {
  OrderSheetError,
  readOrderSheets,
  updateOrderRowValues
} from "./google-sheets";

/**
 * The one seam between admin business logic and storage.
 *
 * Everything above this interface speaks in AdminOrder* types and knows
 * nothing about spreadsheets. Swapping Google Sheets for Supabase later means
 * writing a second implementation of this interface — the service, the API
 * routes, and the whole admin UI stay as they are.
 */
export interface AdminOrderRepository {
  /** Full snapshot: one Orders read + one OrderItems read, joined in memory. */
  listOrders(): Promise<AdminOrderDetail[]>;
  updateOrder(orderId: string, patch: AdminOrderPatch): Promise<void>;
  /**
   * Server-only. Deliberately not on AdminOrderDetail so the slip's storage
   * identifier can never be serialised into a client payload.
   */
  getSlipFileId(orderId: string): Promise<string | null>;
}

/** Only these columns may ever be written by the admin. */
export const ADMIN_WRITABLE_COLUMNS = {
  paymentStatus: "PAYMENT_STATUS",
  orderStatus: "ORDER_STATUS",
  shippingProvider: "SHIPPING_PROVIDER",
  trackingNumber: "TRACKING_NUMBER"
} as const satisfies Record<keyof AdminOrderPatch, string>;

export class GoogleSheetsOrderRepository implements AdminOrderRepository {
  async listOrders(): Promise<AdminOrderDetail[]> {
    const { orderRows, orderItemRows } = await readOrderSheets();

    return joinOrderSheets(orderRows, orderItemRows);
  }

  async updateOrder(orderId: string, patch: AdminOrderPatch) {
    const updates: Record<string, string> = {};

    if (patch.paymentStatus !== undefined) {
      updates[ADMIN_WRITABLE_COLUMNS.paymentStatus] = toSheetStatus(
        patch.paymentStatus
      );
    }

    if (patch.orderStatus !== undefined) {
      updates[ADMIN_WRITABLE_COLUMNS.orderStatus] = toSheetStatus(
        patch.orderStatus
      );
    }

    if (patch.shippingProvider !== undefined) {
      updates[ADMIN_WRITABLE_COLUMNS.shippingProvider] = patch.shippingProvider;
    }

    if (patch.trackingNumber !== undefined) {
      updates[ADMIN_WRITABLE_COLUMNS.trackingNumber] = patch.trackingNumber;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    await updateOrderRowValues(orderId, updates);
  }

  async getSlipFileId(orderId: string) {
    const { orderRows } = await readOrderSheets();

    if (orderRows.length === 0) {
      return null;
    }

    const headers = buildHeaderIndex(orderRows[0]);
    const orderIdIndex = headers.ORDER_ID;
    const slipIndex = headers.SLIP_FILE_ID;

    if (orderIdIndex === undefined || slipIndex === undefined) {
      return null;
    }

    for (let index = 1; index < orderRows.length; index += 1) {
      if (cell(orderRows[index], orderIdIndex) === orderId) {
        return cell(orderRows[index], slipIndex) || null;
      }
    }

    return null;
  }
}

type HeaderIndex = Record<string, number>;

function buildHeaderIndex(headerRow: unknown[]): HeaderIndex {
  const index: HeaderIndex = {};

  headerRow.forEach((cell, position) => {
    const header = String(cell ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();

    if (header && !(header in index)) {
      index[header] = position;
    }
  });

  return index;
}

function cell(row: unknown[], index: number | undefined) {
  if (index === undefined) {
    return "";
  }

  return String(row[index] ?? "").trim();
}

function numberCell(row: unknown[], index: number | undefined) {
  if (index === undefined) {
    return 0;
  }

  const raw = cell(row, index).replace(/[^0-9.-]+/g, "");
  if (!raw) {
    return 0;
  }

  const value = Number(raw);

  return Number.isFinite(value) ? value : 0;
}

const requiredOrderHeaders = ["ORDER_ID", "CREATED_AT", "TOTAL"] as const;

/**
 * Normalises raw sheet rows into admin DTOs.
 *
 * A single malformed row degrades to a flagged order rather than taking the
 * whole dashboard down; a missing ORDER_ID is the only thing that makes a row
 * unusable, and those are skipped and counted. Broken *headers* still throw,
 * because that is a real integrity problem the admin must see.
 */
export function joinOrderSheets(
  orderRows: unknown[][],
  orderItemRows: unknown[][]
): AdminOrderDetail[] {
  if (orderRows.length === 0) {
    return [];
  }

  const headers = buildHeaderIndex(orderRows[0]);
  const missing = requiredOrderHeaders.filter((header) => !(header in headers));

  if (missing.length > 0) {
    throw new OrderSheetError("Orders sheet schema is invalid.", 500);
  }

  const itemsByOrderId = groupOrderItems(orderItemRows);
  const orders: AdminOrderDetail[] = [];

  for (let index = 1; index < orderRows.length; index += 1) {
    const row = orderRows[index];
    const orderId = cell(row, headers.ORDER_ID);

    if (!orderId) {
      continue;
    }

    const dataIssues: string[] = [];

    const paymentStatus = parsePaymentStatus(cell(row, headers.PAYMENT_STATUS));
    if (!paymentStatus) {
      dataIssues.push("Unrecognised payment status");
    }

    const orderStatus = parseOrderStatus(cell(row, headers.ORDER_STATUS));
    if (!orderStatus) {
      dataIssues.push("Unrecognised order status");
    }

    const deliveryMethod = parseDeliveryMethod(
      cell(row, headers.DELIVERY_METHOD)
    );
    if (!deliveryMethod) {
      dataIssues.push("Unrecognised delivery method");
    }

    const universitySheetValue = cell(row, headers.UNIVERSITY);
    const university = getUniversityBySheetValue(universitySheetValue);

    const items = itemsByOrderId.get(orderId) ?? [];
    if (items.length === 0) {
      dataIssues.push("No order items found");
    }

    const createdAtIso = cell(row, headers.CREATED_AT);
    if (Number.isNaN(new Date(createdAtIso).getTime())) {
      dataIssues.push("Unreadable created date");
    }

    orders.push({
      orderId,
      createdAtIso,
      universityId: university?.id ?? null,
      universityLabel: university?.brand ?? (universitySheetValue || "—"),
      customerName: cell(row, headers.FULL_NAME),
      phone: cell(row, headers.PHONE),
      deliveryMethod: deliveryMethod ?? "pickup",
      itemCount: items.reduce((count, item) => count + item.quantity, 0),
      subtotalThb: numberCell(row, headers.SUBTOTAL),
      shippingFeeThb: numberCell(row, headers.SHIPPING_FEE),
      totalThb: numberCell(row, headers.TOTAL),
      paymentStatus: paymentStatus ?? "pending",
      orderStatus: orderStatus ?? "new",
      shippingProvider: cell(row, headers.SHIPPING_PROVIDER),
      trackingNumber: cell(row, headers.TRACKING_NUMBER),
      hasSlip: Boolean(cell(row, headers.SLIP_FILE_ID)),
      shippingAddress: cell(row, headers.SHIPPING_ADDRESS),
      notes: cell(row, headers.NOTES),
      items,
      dataIssues
    });
  }

  return orders;
}

function groupOrderItems(rows: unknown[][]) {
  const grouped = new Map<string, AdminOrderItem[]>();

  if (rows.length === 0) {
    return grouped;
  }

  const headers = buildHeaderIndex(rows[0]);

  if (!("ORDER_ID" in headers)) {
    return grouped;
  }

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const orderId = cell(row, headers.ORDER_ID);

    // An item with no parent order is an orphan: skipped, never guessed at.
    if (!orderId) {
      continue;
    }

    const quantity = Math.max(0, Math.round(numberCell(row, headers.QUANTITY)));
    const unitPriceThb = numberCell(row, headers.UNIT_PRICE);
    const storedLineTotal = numberCell(row, headers.LINE_TOTAL);

    const item: AdminOrderItem = {
      itemId: cell(row, headers.ITEM_ID),
      productId: cell(row, headers.PRODUCT_ID),
      shirtColor: cell(row, headers.SHIRT_COLOR),
      size: cell(row, headers.SIZE),
      quantity,
      // Historical snapshot. Never re-priced from the current catalog.
      unitPriceThb,
      lineTotalThb: storedLineTotal || unitPriceThb * quantity
    };

    const existing = grouped.get(orderId);

    if (existing) {
      existing.push(item);
    } else {
      grouped.set(orderId, [item]);
    }
  }

  return grouped;
}

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
