export type UniversityId = "bangmod" | "ladkrabang" | "north-bangkok";

export type University = {
  id: UniversityId;
  slug: string;
  name: string;
  displayName: string;
  accent: string;
};

export type Product = {
  id: string;
  primaryUniversityId: UniversityId;
  sellableUniversityIds: UniversityId[];
  name: string;
  colorName: string;
  priceThb: number;
  image: string;
  availability?: string;
};

export const universities: University[] = [
  {
    id: "bangmod",
    slug: "bangmod",
    name: "BANGMOD",
    displayName: "KMUTT Bangmod",
    accent: "#1f7a4f"
  },
  {
    id: "ladkrabang",
    slug: "ladkrabang",
    name: "LADKRABANG",
    displayName: "KMITL Ladkrabang",
    accent: "#b43a34"
  },
  {
    id: "north-bangkok",
    slug: "north-bangkok",
    name: "NORTH BANGKOK",
    displayName: "KMUTNB North Bangkok",
    accent: "#23638a"
  }
];

export const availableSizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

export type JerseySize = (typeof availableSizes)[number];

export const products: Product[] = [
  {
    id: "kg-bm-matcha",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod"],
    name: "Matcha Jersey",
    colorName: "Matcha",
    priceThb: 390,
    image: "/products/jersey-matcha.svg",
    availability: "Available now"
  },
  {
    id: "kg-bm-mint-chocolate",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod"],
    name: "Mint Chocolate Chip Jersey",
    colorName: "Mint Chocolate Chip",
    priceThb: 420,
    image: "/products/jersey-mint-chocolate.svg",
    availability: "Preorder"
  },
  {
    id: "kg-lk-strawberry",
    primaryUniversityId: "ladkrabang",
    sellableUniversityIds: ["ladkrabang"],
    name: "Strawberry Milkshake Jersey",
    colorName: "Strawberry Milkshake",
    priceThb: 390,
    image: "/products/jersey-strawberry.svg",
    availability: "Limited run"
  },
  {
    id: "kg-lk-matcha-shared",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod", "ladkrabang"],
    name: "Shared Matcha Jersey",
    colorName: "Matcha",
    priceThb: 390,
    image: "/products/jersey-matcha.svg",
    availability: "Cross-campus item"
  },
  {
    id: "kg-nb-americano",
    primaryUniversityId: "north-bangkok",
    sellableUniversityIds: ["north-bangkok"],
    name: "Americano Jersey",
    colorName: "Americano",
    priceThb: 390,
    image: "/products/jersey-americano.svg",
    availability: "Available now"
  },
  {
    id: "kg-nb-strawberry",
    primaryUniversityId: "north-bangkok",
    sellableUniversityIds: ["north-bangkok"],
    name: "North Strawberry Jersey",
    colorName: "Strawberry Milkshake",
    priceThb: 420,
    image: "/products/jersey-strawberry.svg",
    availability: "Available now"
  }
];

export function getUniversityById(id: UniversityId) {
  return universities.find((university) => university.id === id);
}

export function getUniversityBySlug(slug: string) {
  return universities.find((university) => university.slug === slug);
}

export function getProductById(id: string) {
  return products.find((product) => product.id === id);
}

export function getProductsForUniversity(universityId: UniversityId) {
  return products.filter((product) =>
    product.sellableUniversityIds.includes(universityId)
  );
}
