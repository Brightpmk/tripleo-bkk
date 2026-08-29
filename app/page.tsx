import { StorefrontApp } from "@/components/StorefrontApp";
import type { Product } from "@/lib/catalog";
import { getCachedProductCatalog } from "@/lib/server/product-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  let products: Product[] = [];
  let catalogError = "";

  try {
    products = await getCachedProductCatalog();
  } catch (error) {
    console.error("Product catalog load failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    catalogError =
      "Product catalog is unavailable right now. Please try again in a moment.";
  }

  return <StorefrontApp initialProducts={products} catalogError={catalogError} />;
}
