import type { CartItem } from "./cart";
import { getCartSubtotal } from "./cart";

export type DeliveryMethod = "pickup" | "shipping";

export const SHIPPING_FEE_THB = 50;

export function getShippingFee(deliveryMethod: DeliveryMethod) {
  return deliveryMethod === "shipping" ? SHIPPING_FEE_THB : 0;
}

export function calculateOrderTotals(
  items: CartItem[],
  deliveryMethod: DeliveryMethod
) {
  const itemSubtotalThb = getCartSubtotal(items);
  const shippingFeeThb = getShippingFee(deliveryMethod);

  return {
    itemSubtotalThb,
    shippingFeeThb,
    finalTotalThb: itemSubtotalThb + shippingFeeThb
  };
}
