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

export type NewOrderInput = Omit<
  ConfirmedOrder,
  "orderId" | "createdAtIso" | "paymentStatus"
>;

export function createPublicOrderId(now = new Date()) {
  const year = now.getFullYear();
  const bytes = new Uint8Array(4);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const suffix = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return `KG-${year}-${suffix}`;
}

export async function submitMockOrder(
  order: NewOrderInput
): Promise<ConfirmedOrder> {
  return {
    ...order,
    orderId: createPublicOrderId(),
    createdAtIso: new Date().toISOString(),
    paymentStatus: "pending"
  };
}
