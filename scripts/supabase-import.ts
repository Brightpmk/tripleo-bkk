import {
  hasBlockingMigrationIssues,
  normalizeSheetsForSupabase
} from "../lib/supabase/migration-data";
import {
  createSupabaseAdminClient,
  getSheetEnv,
  getSupabaseEnv,
  printMigrationReport,
  readGoogleSheetSource,
  upsertMigrationData
} from "./supabase/migration-cli";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sheetEnv = getSheetEnv();
  const source = await readGoogleSheetSource(sheetEnv);
  const data = normalizeSheetsForSupabase(source);

  printMigrationReport(data.report);

  if (hasBlockingMigrationIssues(data.report)) {
    throw new Error("Migration validation failed. Fix the reported rows before importing.");
  }

  if (dryRun) {
    console.log("");
    console.log("Dry run complete. No Supabase rows were written.");
    return;
  }

  const supabase = createSupabaseAdminClient(getSupabaseEnv());
  await upsertMigrationData(supabase, data);

  console.log("");
  console.log("Import complete. Rows were upserted by PRODUCT_ID, ORDER_ID, and ITEM_ID.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
