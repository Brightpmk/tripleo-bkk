import "server-only";

import { unstable_cache } from "next/cache";
import {
  normalizeTrackingName,
  normalizeTrackingPhone,
  validateTrackingQuery,
  type PublicTrackedOrder,
  type TrackingSearchMode
} from "@/lib/tracking";
import type { AdminOrderDetail } from "@/lib/orders-admin";
import {
  GoogleSheetsOrderRepository,
  type AdminOrderRepository
} from "./order-repository";
import { ADMIN_ORDERS_CACHE_TAG } from "./order-admin-service";

/**
 * Tracking UI -> Tracking Service -> AdminOrderRepository -> Google Sheets.
 *
 * This module never touches a spreadsheet: it asks the repository for orders
 * and maps them into the public DTO. Swapping in a Supabase repository later
 * changes nothing here or above.
 */

const TRACKING_CACHE_SECONDS = 15;

const defaultRepository: AdminOrderRepository = new GoogleSheetsOrderRepository();

/**
 * The whole-orders snapshot is cached, not the customer's search. Filtering
 * happens per request against the cached snapshot, so no user-specific
 * response is ever shared. The cache carries the admin tag so an admin status
 * change invalidates tracking immediately rather than up to 15s later.
 */
const loadCachedOrders = unstable_cache(
  async () => defaultRepository.listOrders(),
  ["tracking-orders-snapshot-v1"],
  { revalidate: TRACKING_CACHE_SECONDS, tags: [ADMIN_ORDERS_CACHE_TAG] }
);

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
    orders = repository ? await repository.listOrders() : await loadCachedOrders();
  } catch (error) {
    // Never leak the Google API error, spreadsheet ID, or range.
    console.error("Tracking lookup failed", {
      mode: validation.mode,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    throw new TrackingUnavailableError();
  }

  const matches = orders.filter((order) =>
    matchesTrackingQuery(order, validation.mode, validation.normalized)
  );

  return {
    ok: true,
    // Newest first. Separate orders are never merged, even for the same
    // customer — ORDER_ID stays the identity.
    orders: matches
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
