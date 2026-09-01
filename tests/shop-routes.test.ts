import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getCartItemsForUniversity,
  addCartItem,
  getCartTotalQuantity,
  type CartItem
} from "@/lib/cart";
import { SIZE_SURCHARGE_THB } from "@/lib/size-pricing";
import {
  getProductsForUniversity,
  getShopPath,
  getShopPathForUniversityId,
  getUniversityByRouteSlug,
  isUniversityRouteSlug,
  universities,
  universityRouteSlugs,
  type Product,
  type UniversityId
} from "@/lib/catalog";

const projectRoot = resolve(__dirname, "..");

function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf-8");
}

/**
 * The slug → university contract for the `/shop/[university]` route.
 * Written out literally so a wrong mapping fails here rather than in a
 * customer's shared link.
 */
const expectedSlugMapping: Array<{
  slug: string;
  universityId: UniversityId;
  brand: string;
  sheetValue: string;
}> = [
  {
    slug: "msu",
    universityId: "mahasarakham",
    brand: "msu.swagclub",
    sheetValue: "MAHASARAKHAM"
  },
  {
    slug: "btu",
    universityId: "bangkok-thonburi",
    brand: "btu.swagclub",
    sheetValue: "BANGKOK THONBURI"
  },
  {
    slug: "ru",
    universityId: "ramkhamhaeng",
    brand: "ru.swagclub",
    sheetValue: "RAMKHAMHAENG"
  },
  {
    slug: "mfu",
    universityId: "mae-fah-luang",
    brand: "mfu.swagclub",
    sheetValue: "MAE FAH LUANG"
  },
  {
    slug: "mju",
    universityId: "maejo",
    brand: "mju.swagclub",
    sheetValue: "MAEJO"
  },
  {
    slug: "bm",
    universityId: "bangmod",
    brand: "bm.swagclub",
    sheetValue: "BANGMOD"
  },
  {
    slug: "nb",
    universityId: "north-bangkok",
    brand: "nb.swagclub",
    sheetValue: "NORTH BANGKOK"
  },
  {
    slug: "lkb",
    universityId: "ladkrabang",
    brand: "lkb.swagclub",
    sheetValue: "LADKRABANG"
  }
];

describe("shop route slugs", () => {
  it("supports exactly the eight documented slugs", () => {
    expect([...universityRouteSlugs]).toEqual([
      "msu",
      "btu",
      "ru",
      "mfu",
      "mju",
      "bm",
      "nb",
      "lkb"
    ]);
    expect(new Set(universityRouteSlugs).size).toBe(8);
  });

  it.each(expectedSlugMapping)(
    "maps /shop/$slug to $brand",
    ({ slug, universityId, brand, sheetValue }) => {
      const university = getUniversityByRouteSlug(slug);

      expect(university).toBeDefined();
      expect(university?.id).toBe(universityId);
      expect(university?.brand).toBe(brand);
      expect(university?.sheetValue).toBe(sheetValue);
    }
  );

  it("gives every university a route slug and a shop path", () => {
    expect(universities).toHaveLength(8);

    universities.forEach((university) => {
      expect(isUniversityRouteSlug(university.routeSlug)).toBe(true);
      expect(getShopPath(university)).toBe(`/shop/${university.routeSlug}`);
      expect(getShopPathForUniversityId(university.id)).toBe(
        `/shop/${university.routeSlug}`
      );
    });
  });

  it("keeps the URL slug separate from the persisted value", () => {
    // The short slug is only an address. `brand` and `sheetValue` are the
    // values that get stored, and a slug must never be one of them.
    universities.forEach((university) => {
      expect(university.routeSlug).not.toBe(university.brand);
      expect(university.routeSlug).not.toBe(university.sheetValue);
      expect(university.brand).toBe(`${university.routeSlug}.swagclub`);
      expect(university.sheetValue).toBe(university.sheetValue.toUpperCase());
    });

    expect(getUniversityByRouteSlug("bm")?.sheetValue).toBe("BANGMOD");
    expect(getUniversityByRouteSlug("bm")?.brand).toBe("bm.swagclub");
  });

  it.each([
    "hello",
    "",
    "BM",
    "bm.swagclub",
    "bangmod",
    "mahasarakham",
    "shop",
    "bm/",
    "../admin",
    "msu ",
    "undefined"
  ])("does not resolve the unsupported slug %j", (slug) => {
    expect(getUniversityByRouteSlug(slug)).toBeUndefined();
    expect(isUniversityRouteSlug(slug)).toBe(false);
  });
});

describe("shop route product filtering", () => {
  const products: Product[] = universities.map((university, index) => ({
    id: `p-${university.routeSlug}`,
    primaryUniversityId: university.id,
    sellableUniversityIds: [university.id],
    name: `Colour ${index} Shirt`,
    colorName: `Colour ${index}`,
    priceThb: 390,
    image: "/products/product-placeholder.svg",
    availableSizes: ["M", "3XL"],
    active: true,
    sortOrder: index
  }));

  it.each(expectedSlugMapping)(
    "shows only $slug products on /shop/$slug",
    ({ slug }) => {
      const university = getUniversityByRouteSlug(slug);
      expect(university).toBeDefined();

      const visible = getProductsForUniversity(products, university!.id);

      expect(visible.map((product) => product.id)).toEqual([`p-${slug}`]);
    }
  );

  it("hides inactive products from a shop route", () => {
    const university = getUniversityByRouteSlug("bm")!;
    const withInactive: Product[] = [
      ...products,
      {
        ...products[0],
        id: "p-bm-retired",
        primaryUniversityId: university.id,
        sellableUniversityIds: [university.id],
        active: false
      }
    ];

    expect(
      getProductsForUniversity(withInactive, university.id).map((p) => p.id)
    ).toEqual(["p-bm"]);
  });
});

describe("cart behaviour across shop navigation", () => {
  const bangmod = getUniversityByRouteSlug("bm")!;
  const maejo = getUniversityByRouteSlug("mju")!;

  const bangmodProduct: Product = {
    id: "p-bm",
    primaryUniversityId: bangmod.id,
    sellableUniversityIds: [bangmod.id],
    name: "Bone Tee",
    colorName: "Bone",
    priceThb: 390,
    image: "/products/product-placeholder.svg",
    availableSizes: ["M", "3XL"],
    active: true,
    sortOrder: 1
  };

  const cart: CartItem[] = addCartItem([], {
    product: bangmodProduct,
    universityId: bangmod.id,
    size: "3XL",
    quantity: 2
  });

  it("keeps the cart when navigating within the same campus", () => {
    // `/shop/bm` → `/products/p-bm` → `/shop/bm` all scope to the same
    // university, so nothing is dropped.
    expect(getCartItemsForUniversity(cart, bangmod.id)).toEqual(cart);
    expect(getCartTotalQuantity(getCartItemsForUniversity(cart, bangmod.id))).toBe(2);
  });

  it("keeps the 3XL surcharge on a cart carried across navigation", () => {
    const [line] = getCartItemsForUniversity(cart, bangmod.id);

    expect(line.sizeSurchargeThb).toBe(SIZE_SURCHARGE_THB);
    expect(line.unitPriceThb).toBe(390 + SIZE_SURCHARGE_THB);
  });

  it("drops another campus's items when a different shop route is opened", () => {
    expect(getCartItemsForUniversity(cart, maejo.id)).toEqual([]);
  });

  it("mounts the cart provider above every route so it survives navigation", () => {
    const layout = readSource("app/layout.tsx");

    expect(layout).toContain("CartProvider");
    expect(layout).toMatch(/<CartProvider>\{children\}<\/CartProvider>/);
  });
});

describe("real routing replaces the old hash navigation", () => {
  const landing = readSource("components/UniversityLanding.tsx");
  const storefront = readSource("components/StorefrontApp.tsx");
  const shopPage = readSource("app/shop/[university]/page.tsx");
  const homePage = readSource("app/page.tsx");
  const detailView = readSource("app/products/[productId]/ProductDetailView.tsx");

  it("links every university on the landing page to its shop route", () => {
    expect(landing).toContain("getShopPath(university)");
    expect(landing).toContain("<Link");
    // Selection must not be a client-state mutation any more.
    expect(landing).not.toContain("onSelect");
  });

  it("validates the route param and 404s an unsupported slug", () => {
    expect(shopPage).toContain("getUniversityByRouteSlug");
    expect(shopPage).toContain("notFound()");
    expect(shopPage).toMatch(/if \(!university\) \{\s*notFound\(\);/);
  });

  it("generates per-university metadata for each shop route", () => {
    expect(shopPage).toContain("export async function generateMetadata");
    expect(shopPage).toContain("university.brand");
    expect(shopPage).toContain("alternates");
  });

  it("leaves the landing page free of the storefront step machine", () => {
    expect(homePage).toContain("UniversityLanding");
    expect(homePage).not.toContain("StorefrontApp");
  });

  it("no longer writes a #shop- fragment anywhere", () => {
    [storefront, detailView, homePage].forEach((source) => {
      expect(source).not.toContain("#shop-");
      expect(source).not.toContain("location.hash");
    });

    // The landing page only *reads* a legacy fragment to forward it once.
    expect(landing).not.toMatch(/replaceState\([^)]*`#shop-/);
    expect(landing).toContain("router.replace(getShopPath(university))");
  });

  it("points product detail links at the shop route, not the old query step", () => {
    expect(detailView).not.toContain('href="/?step=shop"');
    expect(detailView).not.toContain('href="/?step=cart"');
    expect(detailView).toContain("getShopPath(university)");
    expect(detailView).toContain("${shopPath}?step=cart");
  });
});
