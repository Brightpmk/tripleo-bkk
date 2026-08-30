export const universityIds = [
  "mahasarakham",
  "bangkok-thonburi",
  "ramkhamhaeng",
  "mae-fah-luang",
  "maejo",
  "bangmod",
  "north-bangkok",
  "ladkrabang"
] as const;

export type UniversityId = (typeof universityIds)[number];

/**
 * Canonical UNIVERSITY values as stored in the Google Sheets workbook
 * (Products.UNIVERSITY and Orders.UNIVERSITY). These strings are the
 * database contract — never change an existing one, only add new ones.
 * Everything the customer sees comes from `brand` / `shortName` instead.
 */
export const universitySheetValues = [
  "MAHASARAKHAM",
  "BANGKOK THONBURI",
  "RAMKHAMHAENG",
  "MAE FAH LUANG",
  "MAEJO",
  "BANGMOD",
  "NORTH BANGKOK",
  "LADKRABANG"
] as const;

export type UniversitySheetValue = (typeof universitySheetValues)[number];

export type University = {
  id: UniversityId;
  slug: string;
  /** Canonical Google Sheets value. Persisted — do not change. */
  sheetValue: UniversitySheetValue;
  /** University sub-brand shown as the primary label, e.g. "msu.swagclub". */
  brand: string;
  /** Short university name shown as the secondary label. */
  shortName: string;
  /** Full official university name, used for accessible labels. */
  fullName: string;
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
  availableSizes: ShirtSize[];
  active: boolean;
  sortOrder: number;
  availability?: string;
};

export const universities: University[] = [
  {
    id: "mahasarakham",
    slug: "mahasarakham",
    sheetValue: "MAHASARAKHAM",
    brand: "msu.swagclub",
    shortName: "Mahasarakham",
    fullName: "Mahasarakham University",
    accent: "#C08A2E"
  },
  {
    id: "bangkok-thonburi",
    slug: "bangkok-thonburi",
    sheetValue: "BANGKOK THONBURI",
    brand: "btu.swagclub",
    shortName: "Bangkok Thonburi",
    fullName: "Bangkok Thonburi University",
    accent: "#8A5BA6"
  },
  {
    id: "ramkhamhaeng",
    slug: "ramkhamhaeng",
    sheetValue: "RAMKHAMHAENG",
    brand: "ru.swagclub",
    shortName: "Ramkhamhaeng",
    fullName: "Ramkhamhaeng University",
    accent: "#3F5EA8"
  },
  {
    id: "mae-fah-luang",
    slug: "mae-fah-luang",
    sheetValue: "MAE FAH LUANG",
    brand: "mfu.swagclub",
    shortName: "Mae Fah Luang",
    fullName: "Mae Fah Luang University",
    accent: "#C2603C"
  },
  {
    id: "maejo",
    slug: "maejo",
    sheetValue: "MAEJO",
    brand: "mju.swagclub",
    shortName: "Maejo",
    fullName: "Maejo University",
    accent: "#5E8C3A"
  },
  {
    id: "bangmod",
    slug: "bangmod",
    sheetValue: "BANGMOD",
    brand: "bm.swagclub",
    shortName: "Bangmod",
    fullName: "King Mongkut's University of Technology Thonburi",
    accent: "#1F7A4F"
  },
  {
    id: "north-bangkok",
    slug: "north-bangkok",
    sheetValue: "NORTH BANGKOK",
    brand: "nb.swagclub",
    shortName: "North Bangkok",
    fullName: "King Mongkut's University of Technology North Bangkok",
    accent: "#23638A"
  },
  {
    id: "ladkrabang",
    slug: "ladkrabang",
    sheetValue: "LADKRABANG",
    brand: "lkb.swagclub",
    shortName: "Ladkrabang",
    fullName: "King Mongkut's Institute of Technology Ladkrabang",
    accent: "#B43A34"
  }
];

export const commonSizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

export type ShirtSize = string;

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
