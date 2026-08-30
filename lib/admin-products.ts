export const adminUniversities = [
  "BANGMOD",
  "LADKRABANG",
  "NORTH BANGKOK"
] as const;

export type AdminUniversity = (typeof adminUniversities)[number];

export const adminProductSizes = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL"
] as const;

export type AdminProduct = {
  productId: string;
  university: AdminUniversity;
  shirtColor: string;
  priceThb: number;
  imageUrl: string;
  availableSizes: string[];
  active: boolean;
  sortOrder: number;
};

export type AdminProductInput = AdminProduct;
