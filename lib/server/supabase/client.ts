import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "../env";

export type SupabaseProductRow = {
  product_id: string;
  university: string;
  shirt_color: string;
  base_price_thb: number;
  image_url: string | null;
  available_sizes: string[];
  active: boolean;
  sort_order: number;
};

export type SupabaseOrderRow = {
  order_id: string;
  created_at: string;
  full_name: string;
  phone: string;
  university: string;
  delivery_method: "pickup" | "shipping";
  shipping_address: string | null;
  shipping_fee_thb: number;
  subtotal_thb: number;
  total_thb: number;
  payment_status: "pending" | "verified" | "review_required" | "rejected";
  slip_file_id: string | null;
  order_status: "new" | "preparing" | "shipped" | "completed" | "cancelled";
  shipping_provider: string | null;
  tracking_number: string | null;
  notes: string | null;
};

export type SupabaseOrderItemRow = {
  order_id: string;
  item_id: string;
  product_id: string;
  shirt_color: string;
  size: string;
  quantity: number;
  unit_price_thb: number;
  line_total_thb: number;
};

let cachedSupabaseServiceClient: SupabaseClient | null = null;

export function resetSupabaseClientForTests() {
  cachedSupabaseServiceClient = null;
}

export function getSupabaseServiceClient() {
  if (cachedSupabaseServiceClient) {
    return cachedSupabaseServiceClient;
  }

  const env = getSupabaseEnv();

  cachedSupabaseServiceClient = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          "X-Client-Info": "kinggallery-studio-phase1-migration"
        }
      }
    }
  );

  return cachedSupabaseServiceClient;
}
