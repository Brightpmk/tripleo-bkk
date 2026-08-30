import type { CartItem } from "./cart";
import type { UniversityId } from "./catalog";
import type { DeliveryMethod } from "./pricing";

/**
 * Canonical payment states. Stored UPPERCASE in Orders.PAYMENT_STATUS.
 * "verified" is what the admin surfaces as "Paid" — the stored value is kept
 * as-is so historical rows and any downstream reader stay valid.
 */
export type PaymentStatus =
  | "pending"
  | "verified"
  | "review_required"
  | "rejected";

export type CheckoutDetails = {
  fullName: string;
  phone: string;
  deliveryMethod: DeliveryMethod;
  shippingAddress: string;
};

export type ConfirmedOrder = {
  orderId: string;
  createdAtIso: string;
  universityId: UniversityId;
  items: CartItem[];
  checkout: CheckoutDetails;
  itemSubtotalThb: number;
  shippingFeeThb: number;
  finalTotalThb: number;
  paymentStatus: PaymentStatus;
  slipSelected: boolean;
  slipFileId?: string;
};
