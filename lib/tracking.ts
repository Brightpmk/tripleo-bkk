import type { PaymentStatus } from "./orders";
import type { DeliveryMethod } from "./pricing";
import type { AdminOrderStatus } from "./orders-admin";

/**
 * Public order tracking — shared vocabulary.
 *
 * The customer-facing surface of the same statuses the admin writes.
 */

/* ── Query limits ───────────────────────────────────────────────── */

export const MAX_TRACKING_NAME_LENGTH = 80;
export const MAX_TRACKING_PHONE_LENGTH = 24;
/** Short enough to be a typo, long enough to stop enumeration sweeps. */
export const MIN_TRACKING_NAME_LENGTH = 3;
export const MIN_TRACKING_PHONE_DIGITS = 9;

export type TrackingSearchMode = "name" | "phone";

export type TrackingQuery = {
  mode: TrackingSearchMode;
  value: string;
};

export type TrackingQueryValidation =
  | { ok: true; mode: TrackingSearchMode; normalized: string }
  | { ok: false; message: string };

/* ── Normalisation ──────────────────────────────────────────────── */

/** Trim, collapse repeated whitespace, casefold. */
export function normalizeTrackingName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Digits only, so "081-234 5678" and "081 234 5678" both match "0812345678".
 * A leading Thai country code is folded to the national 0-prefixed form;
 * leading zeros are otherwise always preserved because the value is a string.
 */
export function normalizeTrackingPhone(value: string) {
  const digits = value.replace(/\D+/g, "");

  if (digits.startsWith("66") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }

  return digits;
}

export function validateTrackingQuery(
  mode: unknown,
  rawValue: unknown
): TrackingQueryValidation {
  if (mode !== "name" && mode !== "phone") {
    return { ok: false, message: "Choose whether to search by name or phone." };
  }

  if (typeof rawValue !== "string") {
    return { ok: false, message: "Enter your name or phone number." };
  }

  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {
      ok: false,
      message:
        mode === "name"
          ? "Enter the full name used on the order."
          : "Enter the phone number used on the order."
    };
  }

  if (mode === "name") {
    if (trimmed.length > MAX_TRACKING_NAME_LENGTH) {
      return {
        ok: false,
        message: `Name must be ${MAX_TRACKING_NAME_LENGTH} characters or fewer.`
      };
    }

    const normalized = normalizeTrackingName(trimmed);

    if (normalized.length < MIN_TRACKING_NAME_LENGTH) {
      return { ok: false, message: "Enter the full name used on the order." };
    }

    return { ok: true, mode, normalized };
  }

  if (trimmed.length > MAX_TRACKING_PHONE_LENGTH) {
    return {
      ok: false,
      message: `Phone number must be ${MAX_TRACKING_PHONE_LENGTH} characters or fewer.`
    };
  }

  const normalized = normalizeTrackingPhone(trimmed);

  if (normalized.length < MIN_TRACKING_PHONE_DIGITS) {
    return { ok: false, message: "Enter the full phone number used on the order." };
  }

  return { ok: true, mode, normalized };
}

/* ── Public DTO ─────────────────────────────────────────────────── */

export type PublicTrackedItem = {
  shirtColor: string;
  size: string;
  quantity: number;
};

/**
 * Everything the browser is allowed to see.
 *
 * Deliberately absent: shipping address, phone, customer name, slip file ID,
 * slip URL, notes, internal row numbers, spreadsheet identifiers.
 */
export type PublicTrackedOrder = {
  orderId: string;
  placedAtIso: string;
  universityBrand: string;
  items: PublicTrackedItem[];
  itemCount: number;
  totalThb: number;
  paymentStatus: PaymentStatus;
  orderStatus: AdminOrderStatus;
  deliveryMethod: DeliveryMethod;
  shippingProvider: string;
  trackingNumber: string;
};

export type TrackingSearchResult =
  | { ok: true; orders: PublicTrackedOrder[] }
  | { ok: false; message: string };

/* ── Customer-facing status language ────────────────────────────── */

export const trackingPaymentLabels: Record<PaymentStatus, string> = {
  pending: "Awaiting verification",
  verified: "Payment confirmed",
  review_required: "Being reviewed",
  rejected: "Payment issue"
};

export const trackingPaymentNotes: Record<PaymentStatus, string> = {
  pending: "We have your slip and will confirm it shortly.",
  verified: "Your payment has been confirmed by our team.",
  review_required: "We need to take a closer look at your payment slip.",
  rejected: "There was a problem with this payment. Please contact us."
};

export const trackingOrderLabels: Record<AdminOrderStatus, string> = {
  new: "Order received",
  preparing: "Preparing",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled"
};

/* ── Timeline ───────────────────────────────────────────────────── */

export const trackingStages = [
  "new",
  "preparing",
  "shipped",
  "completed"
] as const;

export type TrackingStage = (typeof trackingStages)[number];

export const trackingStageLabels: Record<TrackingStage, string> = {
  new: "Order received",
  preparing: "Preparing",
  shipped: "Shipped",
  completed: "Completed"
};

export const trackingStageDescriptions: Record<TrackingStage, string> = {
  new: "We have your order.",
  preparing: "Your shirts are being packed.",
  shipped: "On the way to you.",
  completed: "Order complete."
};

export type TrackingTimelineStep = {
  stage: TrackingStage;
  label: string;
  description: string;
  /** Reached or passed. Never true for a stage the order has not reached. */
  complete: boolean;
  /** The stage the order is sitting at right now. */
  current: boolean;
};

export type TrackingTimeline = {
  cancelled: boolean;
  steps: TrackingTimelineStep[];
};

/**
 * Progress is derived strictly from ORDER_STATUS — a later stage is never
 * marked complete on a guess. A cancelled order stops the timeline instead
 * of pretending to continue through it.
 */
export function buildTrackingTimeline(
  orderStatus: AdminOrderStatus
): TrackingTimeline {
  if (orderStatus === "cancelled") {
    return { cancelled: true, steps: [] };
  }

  const currentIndex = trackingStages.indexOf(orderStatus as TrackingStage);
  const reachedIndex = currentIndex < 0 ? 0 : currentIndex;

  return {
    cancelled: false,
    steps: trackingStages.map((stage, index) => ({
      stage,
      label: trackingStageLabels[stage],
      description: trackingStageDescriptions[stage],
      complete: index <= reachedIndex,
      current: index === reachedIndex
    }))
  };
}

/** Shipping fields are meaningless on a pickup order. */
export function showsShippingDetails(order: PublicTrackedOrder) {
  return order.deliveryMethod === "shipping";
}
