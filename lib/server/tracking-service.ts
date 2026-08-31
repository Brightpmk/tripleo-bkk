import "server-only";

import {
  normalizeTrackingName,
  normalizeTrackingPhone,
  validateTrackingQuery,
  type PublicTrackedOrder,
  type TrackingSearchMode
} from "@/lib/tracking";
import type { AdminOrderDetail } from "@/lib/orders-admin";
import {
  type AdminOrderRepository
} from "./order-repository";
import { searchSupabaseTrackingOrders } from "./supabase/order-repository";

/**
 * Tracking UI -> Tracking Service -> Supabase.
 *
 * Public tracking searches are server-side exact lookups over generated
 * normalized columns. The browser never receives customer PII, slip IDs, or
 * Supabase credentials.
 */

export class TrackingUnavailableError extends Error {
  constructor() {
    super("Tracking is temporarily unavailable.");
    this.name = "TrackingUnavailableError";
  }
}

export type TrackingSearchInput = {
  mode: unknown;
  value: unknown;
};

export type TrackingServiceResult =
  | { ok: true; orders: PublicTrackedOrder[] }
  | { ok: false; status: number; message: string };

export async function searchTrackedOrders(
  input: TrackingSearchInput,
  repository?: AdminOrderRepository
): Promise<TrackingServiceResult> {
  const validation = validateTrackingQuery(input.mode, input.value);

  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.message };
  }

  let orders: AdminOrderDetail[];

  try {
    orders = repository
      ? (await repository.listOrders()).filter((order) =>
          matchesTrackingQuery(order, validation.mode, validation.normalized)
        )
      : await searchSupabaseTrackingOrders(validation.mode, validation.normalized);
  } catch (error) {
    // Never leak database errors, SQL details, or customer data.
    console.error("Tracking lookup failed", {
      mode: validation.mode,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    throw new TrackingUnavailableError();
  }

  return {
    ok: true,
    // Newest first. Separate orders are never merged, even for the same
    // customer — ORDER_ID stays the identity.
    orders: orders
      .slice()
      .sort(
        (a, b) =>
          toTime(b.createdAtIso) - toTime(a.createdAtIso) ||
          b.orderId.localeCompare(a.orderId)
      )
      .map(toPublicTrackedOrder)
  };
}

/**
 * Exact match on the normalised value. No wildcards, prefixes, or fuzzy
 * scoring — a partial name must not be able to enumerate other customers.
 */
export function matchesTrackingQuery(
  order: Pick<AdminOrderDetail, "customerName" | "phone">,
  mode: TrackingSearchMode,
  normalizedQuery: string
) {
  if (mode === "name") {
    return normalizeTrackingName(order.customerName) === normalizedQuery;
  }

  return normalizeTrackingPhone(order.phone) === normalizedQuery;
}

/**
 * The privacy boundary. Only these fields cross to the browser; the address,
 * phone, customer name, slip identifiers, and notes stay on the server.
 */
export function toPublicTrackedOrder(
  order: AdminOrderDetail
): PublicTrackedOrder {
  const isShipping = order.deliveryMethod === "shipping";

  return {
    orderId: order.orderId,
    placedAtIso: order.createdAtIso,
    universityBrand: order.universityLabel,
    items: order.items.map((item) => ({
      shirtColor: item.shirtColor,
      size: item.size,
      quantity: item.quantity
    })),
    itemCount: order.itemCount,
    totalThb: order.totalThb,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    deliveryMethod: order.deliveryMethod,
    // Meaningless on a pickup order, so never sent for one.
    shippingProvider: isShipping ? order.shippingProvider : "",
    trackingNumber: isShipping ? order.trackingNumber : ""
  };
}

function toTime(iso: string) {
  const time = new Date(iso).getTime();

  return Number.isNaN(time) ? 0 : time;
}
