import type { CartItem } from "./cart";
import { getCartSubtotal, getCartTotalQuantity } from "./cart";

export {
  getSizeSurchargeThb,
  getUnitPriceThbForSize,
  hasSizeSurcharge,
  SIZE_SURCHARGE_THB
} from "./size-pricing";

export type DeliveryMethod = "pickup" | "shipping";

export const SHIPPING_BASE_FEE_THB = 50;
export const SHIPPING_FEE_THB = 50;
export const SHIPPING_BASE_ITEM_LIMIT = 10;
export const SHIPPING_EXTRA_ITEM_FEE_THB = 10;

export function getShippingFee(
  deliveryMethod: DeliveryMethod,
  itemCount: number = 1
) {
  if (deliveryMethod === "pickup" || itemCount <= 0) {
    return 0;
  }

  if (itemCount <= SHIPPING_BASE_ITEM_LIMIT) {
    return SHIPPING_BASE_FEE_THB;
  }

  return (
    SHIPPING_BASE_FEE_THB +
    (itemCount - SHIPPING_BASE_ITEM_LIMIT) * SHIPPING_EXTRA_ITEM_FEE_THB
  );
}

export function calculateOrderTotals(
  items: CartItem[],
  deliveryMethod: DeliveryMethod
) {
  const itemSubtotalThb = getCartSubtotal(items);
  const totalQuantity = getCartTotalQuantity(items);
  const shippingFeeThb =
    items.length === 0 && deliveryMethod === "shipping"
      ? 0
      : getShippingFee(deliveryMethod, totalQuantity);

  return {
    itemSubtotalThb,
    shippingFeeThb,
    finalTotalThb: itemSubtotalThb + shippingFeeThb
  };
}

