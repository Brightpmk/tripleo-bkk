import {
  hasBlockingMigrationIssues,
  normalizeSheetsForSupabase
} from "../lib/supabase/migration-data";
import {
  createSupabaseAdminClient,
  getExactCount,
  getMigrationEnv,
  printMigrationReport,
  readGoogleSheetSource,
  selectAll,
  summarizeVerification
} from "./supabase/migration-cli";

async function main() {
  const env = getMigrationEnv();
  const source = normalizeSheetsForSupabase(await readGoogleSheetSource(env));

  printMigrationReport(source.report);

  if (hasBlockingMigrationIssues(source.report)) {
    throw new Error("Source validation failed. Verification stopped before comparing Supabase.");
  }

  const supabase = createSupabaseAdminClient(env);
  const [productCount, orderCount, orderItemCount] = await Promise.all([
    getExactCount(supabase, "products"),
    getExactCount(supabase, "orders"),
    getExactCount(supabase, "order_items")
  ]);

  console.log("");
  console.log("Count comparison");
  console.log(`- Products: Google Sheets ${source.products.length} / Supabase ${productCount}`);
  console.log(`- Orders: Google Sheets ${source.orders.length} / Supabase ${orderCount}`);
  console.log(`- OrderItems: Google Sheets ${source.orderItems.length} / Supabase ${orderItemCount}`);

  const [products, orders, orderItems] = await Promise.all([
    selectAll<
      Pick<
        import("../lib/supabase/migration-data").SupabaseProductInsert,
        "product_id" | "university" | "active" | "image_url" | "available_sizes"
      >
    >(supabase, "products", "product_id, university, active, image_url, available_sizes"),
    selectAll<
      Pick<
        import("../lib/supabase/migration-data").SupabaseOrderInsert,
        "order_id" | "university" | "delivery_method" | "payment_status"
      >
    >(supabase, "orders", "order_id, university, delivery_method, payment_status"),
    selectAll<
      Pick<
        import("../lib/supabase/migration-data").SupabaseOrderItemInsert,
        "order_id" | "item_id" | "size"
      >
    >(supabase, "order_items", "order_id, item_id, size")
  ]);
  const summary = summarizeVerification(source, {
    products,
    orders,
    orderItems
  });

  console.log("");
  console.log("Sample coverage");
  console.log(`- Active products: ${summary.samples.activeProducts}`);
  console.log(`- Inactive products: ${summary.samples.inactiveProducts}`);
  console.log(`- Products with blank image URLs: ${summary.samples.productsWithBlankImages}`);
  console.log(`- Products with 3XL/4XL/5XL: ${summary.samples.productsWithExtendedSizes}`);
  console.log(`- Pickup orders: ${summary.samples.pickupOrders}`);
  console.log(`- Shipping orders: ${summary.samples.shippingOrders}`);
  console.log(`- Pending payments: ${summary.samples.pendingPayments}`);
  console.log(`- Paid payments: ${summary.samples.paidPayments}`);
  console.log(`- Multiple-item orders: ${summary.samples.multipleItemOrders}`);

  if (summary.discrepancies.length > 0) {
    console.log("");
    console.log("Discrepancies");
    for (const discrepancy of summary.discrepancies) {
      console.log(`- ${discrepancy}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Verification passed. Supabase row identities match Google Sheets.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
