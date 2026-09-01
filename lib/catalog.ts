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

/**
 * URL slugs for the public shop routes (`/shop/<slug>`).
 *
 * These are *only* addresses. They are deliberately kept separate from the
 * canonical values that are persisted — `sheetValue` ("BANGMOD") in the
 * database and `brand` ("bm.swagclub") on screen — so a URL can never be
 * mistaken for a stored value, and a slug could be changed without a data
 * migration.
 */
export const universityRouteSlugs = [
  "msu",
  "btu",
  "ru",
  "mfu",
  "mju",
  "bm",
  "nb",
  "lkb"
] as const;

export type UniversityRouteSlug = (typeof universityRouteSlugs)[number];

export type University = {
  id: UniversityId;
  /** URL slug for `/shop/<routeSlug>`. Never persisted. */
  routeSlug: UniversityRouteSlug;
  /** Canonical Google Sheets value. Persisted — do not change. */
  sheetValue: UniversitySheetValue;
  /** University sub-brand shown as the primary label, e.g. "msu.swagclub". */
  brand: string;
  /** Short university name shown as the secondary label. */
  shortName: string;
  /** Full official university name, used for accessible labels. */
  fullName: string;
  /** Official Thai university name. */
  thaiName: string;
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
  /**
   * Full ordered gallery, primary first. Only populated on the product
   * detail page — catalog listings leave it undefined so a grid never
   * fetches or ships every gallery image.
   */
  images?: string[];
};

export const universities: University[] = [
  {
    id: "mahasarakham",
    routeSlug: "msu",
    sheetValue: "MAHASARAKHAM",
    brand: "msu.swagclub",
    shortName: "Mahasarakham",
    fullName: "Mahasarakham University",
    thaiName: "มหาวิทยาลัยมหาสารคาม"
  },
  {
    id: "bangkok-thonburi",
    routeSlug: "btu",
    sheetValue: "BANGKOK THONBURI",
    brand: "btu.swagclub",
    shortName: "Bangkok Thonburi",
    fullName: "Bangkok Thonburi University",
    thaiName: "มหาวิทยาลัยกรุงเทพธนบุรี"
  },
  {
    id: "ramkhamhaeng",
    routeSlug: "ru",
    sheetValue: "RAMKHAMHAENG",
    brand: "ru.swagclub",
    shortName: "Ramkhamhaeng",
    fullName: "Ramkhamhaeng University",
    thaiName: "มหาวิทยาลัยรามคำแหง"
  },
  {
    id: "mae-fah-luang",
    routeSlug: "mfu",
    sheetValue: "MAE FAH LUANG",
    brand: "mfu.swagclub",
    shortName: "Mae Fah Luang",
    fullName: "Mae Fah Luang University",
    thaiName: "มหาวิทยาลัยแม่ฟ้าหลวง"
  },
  {
    id: "maejo",
    routeSlug: "mju",
    sheetValue: "MAEJO",
    brand: "mju.swagclub",
    shortName: "Maejo",
    fullName: "Maejo University",
    thaiName: "มหาวิทยาลัยแม่โจ้"
  },
  {
    id: "bangmod",
    routeSlug: "bm",
    sheetValue: "BANGMOD",
    brand: "bm.swagclub",
    shortName: "Bangmod",
    fullName: "King Mongkut's University of Technology Thonburi",
    thaiName: "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"
  },
  {
    id: "north-bangkok",
    routeSlug: "nb",
    sheetValue: "NORTH BANGKOK",
    brand: "nb.swagclub",
    shortName: "North Bangkok",
    fullName: "King Mongkut's University of Technology North Bangkok",
    thaiName: "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ"
  },
  {
    id: "ladkrabang",
    routeSlug: "lkb",
    sheetValue: "LADKRABANG",
    brand: "lkb.swagclub",
    shortName: "Ladkrabang",
    fullName: "King Mongkut's Institute of Technology Ladkrabang",
    thaiName: "สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง"
  }
];

export const commonSizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

export type ShirtSize = string;

export const productImagePlaceholder = "/products/product-placeholder.svg";

export function getUniversityById(id: UniversityId) {
  return universities.find((university) => university.id === id);
}

/**
 * Resolves a `/shop/<slug>` route param. Returns undefined for anything that
 * is not one of the eight supported slugs, so a route can 404 on the rest.
 */
export function getUniversityByRouteSlug(routeSlug: string) {
  return universities.find(
    (university) => university.routeSlug === routeSlug
  );
}

export function isUniversityRouteSlug(
  value: string
): value is UniversityRouteSlug {
  return universityRouteSlugs.includes(value as UniversityRouteSlug);
}

/** The canonical public path for a university shop. */
export function getShopPath(university: Pick<University, "routeSlug">) {
  return `/shop/${university.routeSlug}`;
}

export function getShopPathForUniversityId(id: UniversityId) {
  const university = getUniversityById(id);
  return university ? getShopPath(university) : "/";
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

export function getAvailableDeliveryMethods(
  universityId: UniversityId | string | null | undefined
): Array<"pickup" | "shipping"> {
  if (universityId === "bangmod") {
    return ["pickup", "shipping"];
  }
  return ["shipping"];
}

export function isDeliveryMethodAllowed(
  universityId: UniversityId | string | null | undefined,
  deliveryMethod: "pickup" | "shipping"
): boolean {
  return getAvailableDeliveryMethods(universityId).includes(deliveryMethod);
}

