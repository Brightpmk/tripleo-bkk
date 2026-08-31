# KingGallery Phase 2 Runtime Cutover

Phase 2 switches the application runtime source of truth from Google Sheets to
Supabase/PostgreSQL.

Google Sheets code and environment variables are intentionally retained for
rollback/reference until production E2E testing passes.

## Runtime Architecture

Customer/admin browser -> Next.js server -> Supabase service role

Runtime ownership after this phase:

- Products: Supabase `public.products`
- Orders: Supabase `public.orders`
- OrderItems: Supabase `public.order_items`
- Payment slips: Google Drive OAuth, unchanged
- Product images: Vercel Blob OIDC, unchanged

The application does not dual-write to Google Sheets.

## Changed Runtime Paths

- Storefront product catalog now reads active products from Supabase.
- Admin product list/create/update/delete now uses Supabase.
- Checkout validates against the Supabase-backed catalog and persists orders
  through `public.create_order_with_items(...)`.
- Admin orders now use `SupabaseOrderRepository`.
- Customer tracking now queries Supabase by `full_name_search` or
  `phone_search` and then batch-loads matching order items.

## Checkout Transaction

`supabase-js` does not group multiple table calls into one transaction. Checkout
therefore uses a PostgreSQL function:

`public.create_order_with_items(p_order jsonb, p_items jsonb)`

The function inserts:

1. one `orders` row
2. all `order_items` rows

If any item insert fails, PostgreSQL rolls back the whole function call. This
prevents orders without items and partial order item writes.

Google Drive upload still happens before the database transaction. If the
database transaction fails, the existing best-effort Drive cleanup runs.

## Security

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- No `NEXT_PUBLIC_` Supabase secret is used.
- RLS remains enabled on all runtime tables.
- Browser roles are not granted broad order access.
- Phase 2 grants Data API access only to `service_role` for the tables/function
  used by the Next.js server.

Supabase changed Data API exposure behavior in 2026: new public tables/functions
may require explicit grants. The Phase 2 migration includes those grants.

## Apply Phase 2 Migration

Run before testing checkout against Supabase:

```powershell
npx supabase db push
```

Manual SQL Editor alternative:

1. Open Supabase SQL Editor.
2. Run `supabase/migrations/20260831100828_phase2_runtime_cutover.sql`.

## Verify Migrated Baseline

```powershell
npm run supabase:verify
```

Expected current baseline:

- Products: Google Sheets 2 / Supabase 2
- Orders: Google Sheets 5 / Supabase 5
- OrderItems: Google Sheets 10 / Supabase 10
- validation issues: none

## Required Vercel Environment Variables

Runtime:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_SLIP_FOLDER_ID`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`
- `BLOB_STORE_ID`

Retained for rollback/import/reference:

- `GOOGLE_ORDER_SPREADSHEET_ID`
- `GOOGLE_ORDERS_RANGE`
- `GOOGLE_ORDER_ITEMS_RANGE`
- `GOOGLE_PRODUCTS_RANGE`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

## Production E2E Checklist

Before launch, manually verify:

- Storefront loads products from Supabase.
- Only active products display.
- 3XL/4XL/5XL size surcharge remains +15 THB per shirt.
- Shipping remains 50 THB.
- Pickup remains 0 THB.
- Checkout creates one order and all item rows atomically.
- Payment slip appears in the existing Google Drive folder.
- `orders.slip_file_id` stores only the Drive file ID.
- Admin products can create, edit, deactivate, and delete products.
- Product image upload/replacement/cleanup still uses Vercel Blob.
- Deleting a product does not remove historical order items.
- Admin order status/payment/tracking updates save to Supabase.
- Customer tracking by full name works.
- Customer tracking by phone works.
- Tracking response does not expose phone, address, notes, slip IDs, or database
  row IDs.
- Mobile checkout, order success, tracking, and admin basics remain usable.

## Rollback Procedure

Rollback is a deliberate code/deployment action, not an automatic runtime
fallback.

1. Revert the Phase 2 runtime cutover commit/deployment.
2. Keep the Supabase data untouched for analysis.
3. Confirm `.env` still contains the retained Google Sheets variables.
4. Redeploy the rollback build.
5. Re-run a Google Sheets checkout/admin/tracking smoke test.

Do not dual-write during rollback.

## Remaining Risks

- The Phase 2 database migration must be applied before checkout can call the
  transaction RPC.
- Production E2E has not been performed by this code change.
- If Data API grants are missing in the live Supabase project, Supabase will
  return `42501 permission denied`. Re-run the Phase 2 migration.
