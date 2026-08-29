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
  availableSizes: JerseySize[];
  active: boolean;
  sortOrder: number;
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

export const commonSizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

export type JerseySize = string;

export const productImagePlaceholder = "/products/product-placeholder.svg";

export function getUniversityById(id: UniversityId) {
  return universities.find((university) => university.id === id);
}

export function getUniversityBySlug(slug: string) {
  return universities.find((university) => university.slug === slug);
}

export function getProductById(products: Product[], id: string) {
  return products.find((product) => product.id === id && product.active);
}

export function getProductsForUniversity(
  products: Product[],
  universityId: UniversityId
) {
  return products.filter((product) =>
    product.active && product.sellableUniversityIds.includes(universityId)
  );
}
