import type { ShirtSize, Product, UniversityId } from "./catalog";
import { getSizeSurchargeThb } from "./size-pricing";

export type CartItem = {
  lineId: string;
  productId: string;
  universityId: UniversityId;
  productName: string;
  colorName: string;
  size: ShirtSize;
  quantity: number;
  /** Product PRICE from the Products sheet, before any size surcharge. */
  basePriceThb: number;
  /** Flat per-shirt surcharge for 3XL and above. */
  sizeSurchargeThb: number;
  /** What one shirt of this size actually costs: base + surcharge. */
  unitPriceThb: number;
  image: string;
};

export type AddCartItemInput = {
  product: Product;
  universityId: UniversityId;
  size: ShirtSize;
  quantity: number;
};

export function buildLineId(input: {
  productId: string;
  universityId: UniversityId;
  size: ShirtSize;
}) {
  return `${input.universityId}:${input.productId}:${input.size}`;
}

export function addCartItem(items: CartItem[], input: AddCartItemInput) {
  const quantity = Math.max(1, Math.floor(input.quantity));
  const lineId = buildLineId({
    productId: input.product.id,
    universityId: input.universityId,
    size: input.size
  });
  const existing = items.find((item) => item.lineId === lineId);

  if (existing) {
    return items.map((item) =>
      item.lineId === lineId
        ? { ...item, quantity: item.quantity + quantity }
        : item
    );
  }

  const sizeSurchargeThb = getSizeSurchargeThb(input.size);

  return [
    ...items,
    {
      lineId,
      productId: input.product.id,
      universityId: input.universityId,
      productName: input.product.name,
      colorName: input.product.colorName,
      size: input.size,
      quantity,
      basePriceThb: input.product.priceThb,
      sizeSurchargeThb,
      unitPriceThb: input.product.priceThb + sizeSurchargeThb,
      image: input.product.image
    }
  ];
}

export function updateCartQuantity(
  items: CartItem[],
  lineId: string,
  quantity: number
) {
  const normalizedQuantity = Math.floor(quantity);

  if (normalizedQuantity <= 0) {
    return removeCartItem(items, lineId);
  }

  return items.map((item) =>
    item.lineId === lineId ? { ...item, quantity: normalizedQuantity } : item
  );
}

export function removeCartItem(items: CartItem[], lineId: string) {
  return items.filter((item) => item.lineId !== lineId);
}

export function getCartItemSubtotal(item: CartItem) {
  return item.quantity * item.unitPriceThb;
}

export function getCartSubtotal(items: CartItem[]) {
  return items.reduce((total, item) => total + getCartItemSubtotal(item), 0);
}
