import type { CartItem } from "./cart";
import type { UniversityId } from "./catalog";
import type { DeliveryMethod } from "./pricing";

export type PaymentStatus = "pending" | "verified" | "rejected";

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
};
