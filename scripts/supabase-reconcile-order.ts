import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSheetsForSupabase } from "../lib/supabase/migration-data";
import {
  reconcileOrder,
  type ReconciliationPlan,
  type ReconciliationTarget
} from "../lib/supabase/order-reconciliation";
import {
  createSupabaseAdminClient,
  getSheetEnv,
  getSupabaseEnv,
  readGoogleSheetSource
} from "./supabase/migration-cli";

/**
 * Manual one-off recovery tool.
 *
 *   npm run supabase:reconcile-order -- KG-2026-668A353F --dry-run
 *   npm run supabase:reconcile-order -- KG-2026-668A353F
 *
 * Imports exactly one archived order (and only its own OrderItems) into
 * Supabase. Aborts if the order or any of its items already exist — Supabase
 * holds newer admin edits and must never be overwritten. Not imported by the
 * app, not reachable over HTTP, and never run on startup or deploy.
 */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("-"));

  if (positional.length !== 1) {
    throw new Error(
      "Usage: npm run supabase:reconcile-order -- <ORDER_ID> [--dry-run]"
    );
  }

  const orderId = positional[0];

  console.log(dryRun ? "Mode: DRY RUN (no writes)" : "Mode: WRITE");
  console.log(`Target ORDER_ID: ${orderId}`);
  console.log("");

  let supabase: SupabaseClient | null = null;

  const result = await reconcileOrder({
    orderId,
    dryRun,
    source: {
      loadNormalized: async () =>
        normalizeSheetsForSupabase(await readGoogleSheetSource(getSheetEnv()))
    },
    target: createSupabaseTarget(() => {
      supabase ??= createSupabaseAdminClient(getSupabaseEnv());
      return supabase;
    })
  });

  if (!result.ok) {
    console.error(`ABORTED (${result.reason}): ${result.message}`);

    for (const detail of result.details) {
      console.error(`- ${detail}`);
    }

    process.exitCode = 1;
    return;
  }

  // Deliberately no name, phone, address, or slip identifier.
  console.log("Source order found and validated.");
  console.log(`- Items: ${result.itemCount} (total quantity ${result.summary.totalQuantity})`);
  console.log(`- ITEM_IDs: ${result.itemIds.join(", ")}`);
  console.log(`- Created at: ${result.summary.createdAt}`);
  console.log(`- University: ${result.summary.university}`);
  console.log(`- Delivery: ${result.summary.deliveryMethod}`);
  console.log(`- Payment status: ${result.summary.paymentStatus}`);
  console.log(`- Order status: ${result.summary.orderStatus}`);
  console.log(
    `- Totals: subtotal ${result.summary.subtotalThb}, shipping ${result.summary.shippingFeeThb}, total ${result.summary.totalThb}`
  );
  console.log(`- Slip reference present: ${result.summary.hasSlipReference ? "yes" : "no"}`);
  console.log(
    `- Shipping address present: ${result.summary.hasShippingAddress ? "yes" : "no"}`
  );
  console.log("- Supabase conflicts: none");
  console.log("");

  if (result.dryRun) {
    console.log("Dry run complete. Zero rows were written.");
    return;
  }

  console.log(
    `Reconciled ${result.orderId} with ${result.itemCount} item(s) in a single transaction.`
  );
  console.log("Run `npm run supabase:verify` to confirm the totals.");
}

function createSupabaseTarget(
  getClient: () => SupabaseClient
): ReconciliationTarget {
  return {
    async findExistingOrderIds(orderId) {
      const { data, error } = await getClient()
        .from("orders")
        .select("order_id")
        .eq("order_id", orderId);

      if (error) {
        throw error;
      }

      return (data ?? []).map((row) => row.order_id as string);
    },

    async findExistingItemIds(itemIds) {
      if (itemIds.length === 0) {
        return [];
      }

      const { data, error } = await getClient()
        .from("order_items")
        .select("item_id")
        .in("item_id", itemIds);

      if (error) {
        throw error;
      }

      return (data ?? []).map((row) => row.item_id as string);
    },

    async insertOrderWithItems(plan: ReconciliationPlan) {
      // Reuses the runtime RPC: a single plpgsql transaction that INSERTs
      // (never upserts), so a duplicate key or a failed item aborts the whole
      // call and leaves neither a partial order nor partial order_items.
      const { error } = await getClient().rpc("create_order_with_items", {
        p_order: {
          order_id: plan.order.order_id,
          created_at: plan.order.created_at,
          full_name: plan.order.full_name,
          phone: plan.order.phone,
          university: plan.order.university,
          delivery_method: plan.order.delivery_method,
          shipping_address: plan.order.shipping_address ?? "",
          shipping_fee_thb: plan.order.shipping_fee_thb,
          subtotal_thb: plan.order.subtotal_thb,
          total_thb: plan.order.total_thb,
          payment_status: plan.order.payment_status,
          slip_file_id: plan.order.slip_file_id ?? "",
          // Historical values are preserved, not reset to defaults.
          order_status: plan.order.order_status,
          shipping_provider: plan.order.shipping_provider ?? "",
          tracking_number: plan.order.tracking_number ?? "",
          notes: plan.order.notes ?? ""
        },
        p_items: plan.items.map((item) => ({
          item_id: item.item_id,
          product_id: item.product_id,
          shirt_color: item.shirt_color,
          size: item.size,
          quantity: item.quantity,
          unit_price_thb: item.unit_price_thb,
          line_total_thb: item.line_total_thb
        }))
      });

      if (error) {
        throw error;
      }
    }
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
