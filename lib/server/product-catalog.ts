import "server-only";

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { listActiveSupabaseCatalog } from "./supabase/product-repository";

export class ProductCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductCatalogError";
  }
}

export const PRODUCT_CATALOG_CACHE_TAG = "swagclub-product-catalog";

const loadCachedProductCatalog = unstable_cache(
  async () => listActiveSupabaseCatalog(),
  ["swagclub-product-catalog-supabase-v1"],
  {
    revalidate: 60,
    tags: [PRODUCT_CATALOG_CACHE_TAG]
  }
);

export async function getCachedProductCatalog() {
  return loadCachedProductCatalog();
}

export function invalidateProductCatalogCache() {
  revalidateTag(PRODUCT_CATALOG_CACHE_TAG, { expire: 0 });
  revalidatePath("/", "page");
}
