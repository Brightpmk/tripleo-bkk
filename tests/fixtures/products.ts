import type { Product } from "@/lib/catalog";

export const testProducts: Product[] = [
  {
    id: "kg-bm-matcha",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod"],
    name: "Matcha Shirt",
    colorName: "Matcha",
    priceThb: 390,
    image: "/products/jersey-matcha.svg",
    availableSizes: ["S", "M", "L"],
    active: true,
    sortOrder: 1
  },
  {
    id: "kg-bm-aurora",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod"],
    name: "Aurora Glow Shirt",
    colorName: "Aurora Glow",
    priceThb: 450,
    image: "/products/jersey-matcha.svg",
    availableSizes: ["XS", "S"],
    active: false,
    sortOrder: 2
  },
  {
    id: "kg-lk-strawberry",
    primaryUniversityId: "ladkrabang",
    sellableUniversityIds: ["ladkrabang"],
    name: "Strawberry Milkshake Shirt",
    colorName: "Strawberry Milkshake",
    priceThb: 420,
    image: "/products/jersey-strawberry.svg",
    availableSizes: ["M", "L", "XL"],
    active: true,
    sortOrder: 3
  }
];
