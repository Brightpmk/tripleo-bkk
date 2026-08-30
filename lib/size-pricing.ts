/**
 * Size surcharge — global business rule.
 *
 * XS through 2XL sell at the product's base PRICE from the Products sheet.
 * Every size from 3XL upwards carries a flat surcharge, charged per shirt
 * (per unit, not per order line).
 *
 * This module is the single source of truth for that rule. The storefront
 * imports it to preview a price; the server imports it to compute the
 * canonical one. The client's number is never trusted — see
 * lib/server/order-validation.ts.
 */

export const SIZE_SURCHARGE_THB = 15;

/** 3XL and above are surcharged. 2XL and below are not. */
export const SIZE_SURCHARGE_MIN_XL_FACTOR = 3;

const extendedSizePattern = /^(\d+)\s*XL$/;

export function normalizeSizeLabel(size: string) {
  return size.trim().replace(/\s+/g, " ").toUpperCase();
}

export function hasSizeSurcharge(size: string) {
  const match = extendedSizePattern.exec(normalizeSizeLabel(size));

  if (!match) {
    return false;
  }

  return Number(match[1]) >= SIZE_SURCHARGE_MIN_XL_FACTOR;
}

export function getSizeSurchargeThb(size: string) {
  return hasSizeSurcharge(size) ? SIZE_SURCHARGE_THB : 0;
}

export function getUnitPriceThbForSize(basePriceThb: number, size: string) {
  return basePriceThb + getSizeSurchargeThb(size);
}
