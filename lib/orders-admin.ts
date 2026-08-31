import { universities, type UniversityId } from "./catalog";
import type { PaymentStatus } from "./orders";
import type { DeliveryMethod } from "./pricing";

/**
 * Shared admin order vocabulary.
 *
 * Every status string the admin renders or writes comes from here so the UI,
 * the API validation, and storage repositories can never drift apart.
 *
 * Sheet values are stored UPPERCASE (that is what the order writer has always
 * emitted). These constants are the lowercase canonical form; `toSheet*`
 * converts on the way out and `parse*` normalises on the way in.
 */

export const BANGKOK_TIME_ZONE = "Asia/Bangkok";

/* ── Payment status ─────────────────────────────────────────────── */

export const paymentStatuses: PaymentStatus[] = [
  "pending",
  "verified",
  "review_required",
  "rejected"
];

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "Pending",
  verified: "Paid",
  review_required: "Review required",
  rejected: "Rejected"
};

export const paymentStatusTones: Record<PaymentStatus, StatusTone> = {
  pending: "warn",
  verified: "ok",
  review_required: "info",
  rejected: "bad"
};

/* ── Order status ───────────────────────────────────────────────── */

export const orderStatuses = [
  "new",
  "preparing",
  "shipped",
  "completed",
  "cancelled"
] as const;

export type AdminOrderStatus = (typeof orderStatuses)[number];

export const orderStatusLabels: Record<AdminOrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled"
};

export const orderStatusTones: Record<AdminOrderStatus, StatusTone> = {
  new: "warn",
  preparing: "info",
  shipped: "info",
  completed: "ok",
  cancelled: "bad"
};

export type StatusTone = "ok" | "warn" | "info" | "bad" | "neutral";

/* ── Field limits (mirrored by server-side validation) ──────────── */

export const MAX_SHIPPING_PROVIDER_LENGTH = 60;
export const MAX_TRACKING_NUMBER_LENGTH = 64;

/* ── Types ──────────────────────────────────────────────────────── */

export type AdminOrderItem = {
  itemId: string;
  productId: string;
  shirtColor: string;
  size: string;
  quantity: number;
  /** Historical snapshot: already includes any size surcharge. */
  unitPriceThb: number;
  lineTotalThb: number;
};

export type AdminOrderSummary = {
  orderId: string;
  createdAtIso: string;
  universityId: UniversityId | null;
  /** Raw database value, kept so unmapped universities still render. */
  universityLabel: string;
  customerName: string;
  phone: string;
  deliveryMethod: DeliveryMethod;
  itemCount: number;
  subtotalThb: number;
  shippingFeeThb: number;
  totalThb: number;
  paymentStatus: PaymentStatus;
  orderStatus: AdminOrderStatus;
  shippingProvider: string;
  trackingNumber: string;
  hasSlip: boolean;
  /** Non-fatal problems found while normalising this row. */
  dataIssues: string[];
};

/** Admin-only. Never returned by public storefront or tracking endpoints. */
export type AdminOrderDetail = AdminOrderSummary & {
  shippingAddress: string;
  notes: string;
  items: AdminOrderItem[];
};

export type AdminOrderPatch = {
  paymentStatus?: PaymentStatus;
  orderStatus?: AdminOrderStatus;
  shippingProvider?: string;
  trackingNumber?: string;
};

/* ── Parsing from stored values ─────────────────────────────────── */

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function parsePaymentStatus(value: unknown): PaymentStatus | null {
  switch (normalizeToken(value)) {
    case "PENDING":
      return "pending";
    case "VERIFIED":
    case "PAID":
      return "verified";
    case "REVIEW_REQUIRED":
    case "REVIEW":
      return "review_required";
    case "REJECTED":
      return "rejected";
    default:
      return null;
  }
}

export function parseOrderStatus(value: unknown): AdminOrderStatus | null {
  switch (normalizeToken(value)) {
    // The order writer emits NEW; PENDING is accepted as an alias.
    case "NEW":
    case "PENDING":
    case "":
      return "new";
    case "PREPARING":
    case "PACKING":
      return "preparing";
    case "SHIPPED":
      return "shipped";
    case "COMPLETED":
    case "DONE":
      return "completed";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    default:
      return null;
  }
}

export function parseDeliveryMethod(value: unknown): DeliveryMethod | null {
  switch (normalizeToken(value)) {
    case "PICKUP":
      return "pickup";
    case "SHIPPING":
      return "shipping";
    default:
      return null;
  }
}

export function getUniversityBySheetValue(value: string) {
  const normalized = value.trim().toUpperCase();

  return universities.find(
    (university) => university.sheetValue.toUpperCase() === normalized
  );
}

/* ── Bangkok time ───────────────────────────────────────────────── */

const bangkokDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANGKOK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const bangkokDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BANGKOK_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/**
 * Calendar day in Thailand as YYYY-MM-DD. Using the formatter rather than
 * date arithmetic keeps "today" anchored to Bangkok midnight, not UTC.
 */
export function bangkokDayKey(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return bangkokDayFormatter.format(date);
}

export function formatBangkokDateTime(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return bangkokDateTimeFormatter.format(date);
}

/* ── List operations (pure, shared by server and client) ────────── */

export type AdminOrderFilters = {
  search: string;
  paymentStatus: PaymentStatus | "ALL";
  orderStatus: AdminOrderStatus | "ALL";
  deliveryMethod: DeliveryMethod | "ALL";
  universityId: UniversityId | "ALL";
};

export type AdminOrderSort = "newest" | "oldest" | "highest" | "lowest";

export const defaultAdminOrderFilters: AdminOrderFilters = {
  search: "",
  paymentStatus: "ALL",
  orderStatus: "ALL",
  deliveryMethod: "ALL",
  universityId: "ALL"
};

/** Digits only, so "081-234 5678" matches "0812345678". Leading zeros kept. */
function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

/**
 * Exact-ish matching only: order ID prefix/substring, name substring, or
 * phone digits. Deliberately not fuzzy — a wrong order is worse than none.
 */
export function matchesOrderSearch(order: AdminOrderSummary, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return true;
  }

  if (order.orderId.toLowerCase().includes(query)) {
    return true;
  }

  if (order.customerName.toLowerCase().includes(query)) {
    return true;
  }

  const queryDigits = digitsOnly(query);

  return (
    queryDigits.length >= 3 && digitsOnly(order.phone).includes(queryDigits)
  );
}

export function filterAdminOrders(
  orders: AdminOrderSummary[],
  filters: AdminOrderFilters
) {
  return orders.filter(
    (order) =>
      (filters.paymentStatus === "ALL" ||
        order.paymentStatus === filters.paymentStatus) &&
      (filters.orderStatus === "ALL" ||
        order.orderStatus === filters.orderStatus) &&
      (filters.deliveryMethod === "ALL" ||
        order.deliveryMethod === filters.deliveryMethod) &&
      (filters.universityId === "ALL" ||
        order.universityId === filters.universityId) &&
      matchesOrderSearch(order, filters.search)
  );
}

export function sortAdminOrders(
  orders: AdminOrderSummary[],
  sort: AdminOrderSort
) {
  const sorted = [...orders];

  switch (sort) {
    case "oldest":
      return sorted.sort(compareByCreatedAt);
    case "highest":
      return sorted.sort((a, b) => b.totalThb - a.totalThb || compareByCreatedAtDesc(a, b));
    case "lowest":
      return sorted.sort((a, b) => a.totalThb - b.totalThb || compareByCreatedAtDesc(a, b));
    case "newest":
    default:
      return sorted.sort(compareByCreatedAtDesc);
  }
}

function toTime(iso: string) {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareByCreatedAt(a: AdminOrderSummary, b: AdminOrderSummary) {
  return toTime(a.createdAtIso) - toTime(b.createdAtIso) ||
    a.orderId.localeCompare(b.orderId);
}

function compareByCreatedAtDesc(a: AdminOrderSummary, b: AdminOrderSummary) {
  return toTime(b.createdAtIso) - toTime(a.createdAtIso) ||
    b.orderId.localeCompare(a.orderId);
}

/* ── Dashboard metrics ──────────────────────────────────────────── */

/**
 * Revenue counts an order unless it was cancelled or its payment was
 * rejected. Everything else (pending, review required, paid) is treated as
 * expected revenue, because the shop is paid up front by transfer.
 */
export function countsTowardRevenue(order: AdminOrderSummary) {
  return order.orderStatus !== "cancelled" && order.paymentStatus !== "rejected";
}

export type AdminDashboardMetrics = {
  totalOrders: number;
  ordersToday: number;
  revenueTodayThb: number;
  totalRevenueThb: number;
  pendingPayments: number;
  paidOrders: number;
  awaitingFulfillment: number;
  shippedOrders: number;
  cancelledOrders: number;
  todayKey: string;
};

export function calculateDashboardMetrics(
  orders: AdminOrderSummary[],
  now: Date = new Date()
): AdminDashboardMetrics {
  const todayKey = bangkokDayKey(now.toISOString());
  const metrics: AdminDashboardMetrics = {
    totalOrders: orders.length,
    ordersToday: 0,
    revenueTodayThb: 0,
    totalRevenueThb: 0,
    pendingPayments: 0,
    paidOrders: 0,
    awaitingFulfillment: 0,
    shippedOrders: 0,
    cancelledOrders: 0,
    todayKey
  };

  for (const order of orders) {
    const isToday = bangkokDayKey(order.createdAtIso) === todayKey;
    const revenueEligible = countsTowardRevenue(order);

    if (isToday) {
      metrics.ordersToday += 1;

      if (revenueEligible) {
        metrics.revenueTodayThb += order.totalThb;
      }
    }

    if (revenueEligible) {
      metrics.totalRevenueThb += order.totalThb;
    }

    if (order.paymentStatus === "pending") {
      metrics.pendingPayments += 1;
    }

    if (order.paymentStatus === "verified") {
      metrics.paidOrders += 1;
    }

    // Paid and not yet out the door.
    if (
      order.paymentStatus === "verified" &&
      (order.orderStatus === "new" || order.orderStatus === "preparing")
    ) {
      metrics.awaitingFulfillment += 1;
    }

    if (order.orderStatus === "shipped") {
      metrics.shippedOrders += 1;
    }

    if (order.orderStatus === "cancelled") {
      metrics.cancelledOrders += 1;
    }
  }

  return metrics;
}
