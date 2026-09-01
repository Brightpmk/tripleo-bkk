import {
  getProductById,
  getUniversityById,
  isDeliveryMethodAllowed,
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
import { getSizeSurchargeThb } from "@/lib/size-pricing";

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
    fieldErrors.universityId = "กรุณาเลือกมหาวิทยาลัยที่เปิดจำหน่าย";
  }

  if (!Array.isArray(request.items) || request.items.length === 0) {
    fieldErrors.items = "กรุณาเพิ่มสินค้าอย่างน้อย 1 ชิ้นลงในตะกร้า";
  }

  const fullName = normalizeString(request.checkout?.fullName);
  const phone = normalizeString(request.checkout?.phone);
  const deliveryMethod = request.checkout?.deliveryMethod;
  const shippingAddress = normalizeString(request.checkout?.shippingAddress);

  if (!fullName) {
    fieldErrors.fullName = "กรุณากรอกชื่อ-นามสกุล";
  }

  if (!phone) {
    fieldErrors.phone = "กรุณากรอกเบอร์โทรศัพท์";
  }

  if (!isDeliveryMethod(deliveryMethod)) {
    fieldErrors.deliveryMethod = "กรุณาเลือกวิธีรับสินค้า";
  } else if (university && !isDeliveryMethodAllowed(university.id, deliveryMethod)) {
    fieldErrors.deliveryMethod =
      university.id === "bangmod"
        ? "กรุณาเลือกวิธีรับสินค้า"
        : "มหาวิทยาลัยนี้รองรับเฉพาะการจัดส่งเท่านั้น";
  }

  if (deliveryMethod === "shipping" && !shippingAddress) {
    fieldErrors.shippingAddress = "กรุณากรอกที่อยู่สำหรับจัดส่ง";
  }


  if (request.slipSelected !== true) {
    fieldErrors.slipSelected = "กรุณาอัปโหลดสลิปการชำระเงิน";
  }

  const items: CartItem[] = [];

  if (university && Array.isArray(request.items)) {
    request.items.forEach((item, index) => {
      const product = getProductById(products, item.productId);
      const itemPrefix = `items.${index}`;
      const quantity = Math.floor(Number(item.quantity));

      if (!product) {
        fieldErrors[`${itemPrefix}.productId`] = "สินค้านี้ไม่พร้อมจำหน่ายแล้ว";
        return;
      }

      if (!product.sellableUniversityIds.includes(university.id)) {
        fieldErrors[`${itemPrefix}.productId`] =
          "Product is not available for this university.";
      }

      if (!isAvailableSize(product, item.size)) {
        fieldErrors[`${itemPrefix}.size`] = "กรุณาเลือกไซส์ที่มีจำหน่าย";
      }

      // Canonical price: product base price plus the surcharge this server
      // derives from the size. The client's number is only compared.
      const sizeSurchargeThb = isAvailableSize(product, item.size)
        ? getSizeSurchargeThb(item.size)
        : 0;
      const unitPriceThb = product.priceThb + sizeSurchargeThb;

      if (
        typeof item.displayedUnitPriceThb === "number" &&
        item.displayedUnitPriceThb !== unitPriceThb
      ) {
        fieldErrors[`${itemPrefix}.price`] =
          "ราคาสินค้ามีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้าอีกครั้ง";
      }

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        fieldErrors[`${itemPrefix}.quantity`] =
          "จำนวนต้องอยู่ระหว่าง 1 ถึง 20 ชิ้น";
      }

      if (
        product.sellableUniversityIds.includes(university.id) &&
        isAvailableSize(product, item.size) &&
        (typeof item.displayedUnitPriceThb !== "number" ||
          item.displayedUnitPriceThb === unitPriceThb) &&
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
          basePriceThb: product.priceThb,
          sizeSurchargeThb,
          unitPriceThb,
          image: product.image
        });
      }
    });
  }

  if (Object.keys(fieldErrors).length > 0 || !isDeliveryMethod(deliveryMethod)) {
    return {
      ok: false,
      message: Object.keys(fieldErrors).some((field) => field.endsWith(".price"))
        ? "ข้อมูลสินค้ามีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้าอีกครั้ง"
        : "กรุณาตรวจสอบข้อมูลที่ทำเครื่องหมายไว้อีกครั้ง",
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
