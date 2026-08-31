import "server-only";

import type { AdminProduct } from "@/lib/admin-products";
import {
  getSupabaseServiceClient,
  type SupabaseProductRow
} from "./client";

export async function listSupabaseProducts(): Promise<AdminProduct[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("product_id, university, shirt_color, base_price_thb, image_url, available_sizes, active, sort_order")
    .order("sort_order", { ascending: true })
    .order("university", { ascending: true })
    .order("shirt_color", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SupabaseProductRow[]).map((product) => ({
    productId: product.product_id,
    university: product.university as AdminProduct["university"],
    shirtColor: product.shirt_color,
    priceThb: product.base_price_thb,
    imageUrl: product.image_url ?? "",
    availableSizes: product.available_sizes,
    active: product.active,
    sortOrder: product.sort_order
  }));
}
