import type { ConfirmedOrder } from "@/lib/orders";
import { getUniversityById } from "@/lib/catalog";

export const ordersHeaders = [
  "ORDER_ID",
  "CREATED_AT",
  "UNIVERSITY",
  "FULL_NAME",
  "PHONE",
  "DELIVERY_METHOD",
  "SHIPPING_ADDRESS",
  "SHIPPING_FEE",
  "SUBTOTAL",
  "TOTAL",
  "PAYMENT_STATUS",
  "SLIP_FILE_ID",
  "SLIP_URL",
  "ORDER_STATUS",
  "SHIPPING_PROVIDER",
  "TRACKING_NUMBER",
  "NOTES"
] as const;

export const orderItemsHeaders = [
  "ORDER_ID",
  "ITEM_ID",
  "PRODUCT_ID",
  "JERSEY_COLOR",
  "SIZE",
  "QUANTITY",
  "UNIT_PRICE",
  "LINE_TOTAL"
] as const;

export type SheetCell = string | number;

export type OrderSheetRows = {
  ordersRow: SheetCell[];
  orderItemsRows: SheetCell[][];
};

export function mapOrderToSheetRows(order: ConfirmedOrder): OrderSheetRows {
  const universityName = getUniversityById(order.universityId)?.name ?? order.universityId;
  const ordersRow: SheetCell[] = [
    order.orderId,
    order.createdAtIso,
    universityName,
    order.checkout.fullName,
    order.checkout.phone,
    order.checkout.deliveryMethod.toUpperCase(),
    order.checkout.deliveryMethod === "shipping"
      ? order.checkout.shippingAddress
      : "",
    order.shippingFeeThb,
    order.itemSubtotalThb,
    order.finalTotalThb,
    order.paymentStatus.toUpperCase(),
    "",
    "",
    "NEW",
    "",
    "",
    ""
  ];

  const orderItemsRows = order.items.map((item, index) => [
    order.orderId,
    `${order.orderId}-${String(index + 1).padStart(2, "0")}`,
    item.productId,
    item.colorName,
    item.size,
    item.quantity,
    item.unitPriceThb,
    item.quantity * item.unitPriceThb
  ]);

  return { ordersRow, orderItemsRows };
}
