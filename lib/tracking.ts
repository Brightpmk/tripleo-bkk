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
    return { ok: false, message: "กรุณาเลือกค้นหาด้วยชื่อ-นามสกุลหรือเบอร์โทรศัพท์" };
  }

  if (typeof rawValue !== "string") {
    return { ok: false, message: "กรุณากรอกชื่อ-นามสกุลหรือเบอร์โทรศัพท์" };
  }

  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {
      ok: false,
      message:
        mode === "name"
          ? "กรุณากรอกชื่อ-นามสกุลที่ใช้ตอนสั่งซื้อ"
          : "กรุณากรอกเบอร์โทรศัพท์ที่ใช้ตอนสั่งซื้อ"
    };
  }

  if (mode === "name") {
    if (trimmed.length > MAX_TRACKING_NAME_LENGTH) {
      return {
        ok: false,
        message: `ชื่อ-นามสกุลต้องไม่เกิน ${MAX_TRACKING_NAME_LENGTH} ตัวอักษร`
      };
    }

    const normalized = normalizeTrackingName(trimmed);

    if (normalized.length < MIN_TRACKING_NAME_LENGTH) {
      return {
        ok: false,
        message: "กรุณากรอกชื่อ-นามสกุลที่ใช้ตอนสั่งซื้อ"
      };
    }

    return { ok: true, mode, normalized };
  }

  if (trimmed.length > MAX_TRACKING_PHONE_LENGTH) {
    return {
      ok: false,
      message: `เบอร์โทรศัพท์ต้องไม่เกิน ${MAX_TRACKING_PHONE_LENGTH} ตัวอักษร`
    };
  }

  const normalized = normalizeTrackingPhone(trimmed);

  if (normalized.length < MIN_TRACKING_PHONE_DIGITS) {
    return {
      ok: false,
      message: "กรุณากรอกเบอร์โทรศัพท์ให้ครบถ้วน"
    };
  }

  return { ok: true, mode, normalized };
}

/* ── Public DTO ─────────────────────────────────────────────────── */

export type PublicTrackedItem = {
  productId?: string;
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

/**
 * Thai labels for the stored statuses. The stored values themselves
 * ("pending", "new", …) are untouched — this is only how they read.
 */
export const trackingPaymentLabels: Record<PaymentStatus, string> = {
  pending: "รอตรวจสอบการชำระเงิน",
  verified: "ชำระเงินแล้ว",
  review_required: "กำลังตรวจสอบเพิ่มเติม",
  rejected: "การชำระเงินมีปัญหา"
};

export const trackingPaymentNotes: Record<PaymentStatus, string> = {
  pending: "เราได้รับสลิปของคุณแล้ว และกำลังตรวจสอบ",
  verified: "ทีมงานยืนยันการชำระเงินของคุณเรียบร้อยแล้ว",
  review_required: "เราต้องตรวจสอบสลิปของคุณเพิ่มเติมอีกเล็กน้อย",
  rejected: "การชำระเงินนี้มีปัญหา กรุณาติดต่อเรา"
};

export const trackingOrderLabels: Record<AdminOrderStatus, string> = {
  new: "รับคำสั่งซื้อแล้ว",
  preparing: "กำลังเตรียมสินค้า",
  shipped: "จัดส่งแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิกแล้ว"
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
  new: "รับคำสั่งซื้อแล้ว",
  preparing: "กำลังเตรียมสินค้า",
  shipped: "จัดส่งแล้ว",
  completed: "สำเร็จ"
};

export const trackingStageDescriptions: Record<TrackingStage, string> = {
  new: "เราได้รับคำสั่งซื้อของคุณแล้ว",
  preparing: "กำลังแพ็กเสื้อของคุณ",
  shipped: "พัสดุกำลังเดินทางไปหาคุณ",
  completed: "คำสั่งซื้อเสร็จสมบูรณ์"
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
