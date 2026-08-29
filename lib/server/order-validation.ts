import {
  getProductById,
  getUniversityById,
  type Product,
  type UniversityId
} from "@/lib/catalog";
import { buildLineId, type CartItem } from "@/lib/cart";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import type { CheckoutDetails } from "@/lib/orders";
import {
  calculateOrderTotals,
  type DeliveryMethod
} from "@/lib/pricing";

export type ValidatedOrderDraft = {
  universityId: UniversityId;
  checkout: CheckoutDetails;
  items: CartItem[];
  itemSubtotalThb: number;
  shippingFeeThb: number;
  finalTotalThb: number;
  slipSelected: true;
};

export type ValidationResult =
  | { ok: true; order: ValidatedOrderDraft }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

const deliveryMethods = ["pickup", "shipping"] as const;

export function validateOrderSubmission(
  request: OrderSubmissionRequest,
  products: Product[]
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const university = getUniversityById(request.universityId);

  if (!university) {
    fieldErrors.universityId = "Select a supported university.";
  }

  if (!Array.isArray(request.items) || request.items.length === 0) {
    fieldErrors.items = "Cart must contain at least one item.";
  }

  const fullName = normalizeString(request.checkout?.fullName);
  const phone = normalizeString(request.checkout?.phone);
  const deliveryMethod = request.checkout?.deliveryMethod;
  const shippingAddress = normalizeString(request.checkout?.shippingAddress);

  if (!fullName) {
    fieldErrors.fullName = "Full name is required.";
  }

  if (!phone) {
    fieldErrors.phone = "Phone number is required.";
  }

  if (!isDeliveryMethod(deliveryMethod)) {
    fieldErrors.deliveryMethod = "Select pickup or shipping.";
  }

  if (deliveryMethod === "shipping" && !shippingAddress) {
    fieldErrors.shippingAddress = "Shipping address is required.";
  }

  if (request.slipSelected !== true) {
    fieldErrors.slipSelected = "Payment slip must be selected.";
  }

  const items: CartItem[] = [];

  if (university && Array.isArray(request.items)) {
    request.items.forEach((item, index) => {
      const product = getProductById(products, item.productId);
      const itemPrefix = `items.${index}`;
      const quantity = Math.floor(Number(item.quantity));

      if (!product) {
        fieldErrors[`${itemPrefix}.productId`] = "Product is not available.";
        return;
      }

      if (!product.sellableUniversityIds.includes(university.id)) {
        fieldErrors[`${itemPrefix}.productId`] =
          "Product is not available for this university.";
      }

      if (!isAvailableSize(product, item.size)) {
        fieldErrors[`${itemPrefix}.size`] = "Select a supported size.";
      }

      if (
        typeof item.displayedUnitPriceThb === "number" &&
        item.displayedUnitPriceThb !== product.priceThb
      ) {
        fieldErrors[`${itemPrefix}.price`] =
          "Product price changed. Please review your cart and try again.";
      }

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        fieldErrors[`${itemPrefix}.quantity`] =
          "Quantity must be between 1 and 20.";
      }

      if (
        product.sellableUniversityIds.includes(university.id) &&
        isAvailableSize(product, item.size) &&
        (typeof item.displayedUnitPriceThb !== "number" ||
          item.displayedUnitPriceThb === product.priceThb) &&
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= 20
      ) {
        items.push({
          lineId: buildLineId({
            productId: product.id,
            universityId: university.id,
            size: item.size
          }),
          productId: product.id,
          universityId: university.id,
          productName: product.name,
          colorName: product.colorName,
          size: item.size,
          quantity,
          unitPriceThb: product.priceThb,
          image: product.image
        });
      }
    });
  }

  if (Object.keys(fieldErrors).length > 0 || !isDeliveryMethod(deliveryMethod)) {
    return {
      ok: false,
      message: Object.keys(fieldErrors).some((field) => field.endsWith(".price"))
        ? "Product details changed. Please review your cart and try again."
        : "Please review the highlighted order details.",
      fieldErrors
    };
  }

  const checkout: CheckoutDetails = {
    fullName,
    phone,
    deliveryMethod,
    shippingAddress: deliveryMethod === "shipping" ? shippingAddress : ""
  };
  const totals = calculateOrderTotals(items, checkout.deliveryMethod);

  return {
    ok: true,
    order: {
      universityId: request.universityId,
      checkout,
      items,
      itemSubtotalThb: totals.itemSubtotalThb,
      shippingFeeThb: totals.shippingFeeThb,
      finalTotalThb: totals.finalTotalThb,
      slipSelected: true
    }
  };
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return deliveryMethods.includes(value as DeliveryMethod);
}

function isAvailableSize(product: Product, value: unknown): value is string {
  return (
    typeof value === "string" &&
    product.availableSizes.includes(value)
  );
}
