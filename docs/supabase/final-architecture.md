# KingGallery Final Supabase Architecture

## Production Runtime

KingGallery.Studio now uses Supabase/PostgreSQL as the production data store for
all catalog, checkout, admin order, and tracking workflows.

Runtime ownership:

- Products: Supabase `public.products`
- Orders: Supabase `public.orders`
- Order items: Supabase `public.order_items`
- Payment slips: private Vercel Blob objects, with transitional Drive reads
- Product images: public Vercel Blob objects in a separate store
- Admin auth: server-only bcrypt hash plus encrypted `iron-session` cookie

Google Sheets is not read or written by the application runtime.

## Removed Google Sheets Runtime Code

The final cleanup removed the runtime Google Sheets adapters and row mappers:

- `lib/server/google-sheets.ts`
- `lib/server/order-row-mapper.ts`
- `lib/server/product-sheet.ts`
- Google Sheets rollback repository exports
- Sheet-specific admin order errors
- Sheet product catalog normalizers
- Sheet row write/delete tests

## Retained Migration Tooling

These files intentionally remain because they support import, verification, and
emergency comparison against the original workbook:

- `scripts/supabase-import.ts`
- `scripts/supabase-verify.ts`
- `scripts/supabase/migration-cli.ts`
- `lib/supabase/migration-data.ts`
- `tests/supabase-migration.test.ts`

The migration scripts keep their own Google Sheets environment validation and
use a read-only Google Sheets scope.

## Environment Variables

Required production variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSWORD_HASH
ADMIN_SESSION_SECRET
BLOB_STORE_ID
PAYMENT_SLIP_BLOB_STORE_ID
```

Safe to remove from Vercel production runtime after this phase:

```text
GOOGLE_ORDER_SPREADSHEET_ID
GOOGLE_ORDERS_RANGE
GOOGLE_ORDER_ITEMS_RANGE
GOOGLE_PRODUCTS_RANGE
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
```

Keep those Google Sheets variables only in local or restricted environments
where `npm run supabase:import:*` or `npm run supabase:verify` will be used.

Drive OAuth variables are optional during the historical-slip transition. See
`docs/payment-slip-blob-migration.md` before removing them.

## Supabase Security

The schema keeps row level security enabled on all runtime tables. Browser roles
do not receive broad access policies. The Next.js server uses only
`SUPABASE_SERVICE_ROLE_KEY`, and no `NEXT_PUBLIC_` Supabase secret is required.

The Phase 2 migration explicitly grants `service_role` access to the runtime
tables and the `create_order_with_items(jsonb, jsonb)` RPC. Supabase changed
Data API exposure behavior for new public tables/functions in 2026, so those
explicit grants are required for API access.

Checkout writes go through `public.create_order_with_items(...)`, which inserts
the order and all item snapshots in one PostgreSQL transaction. If item insert
validation fails, the order insert rolls back.

## Performance Notes

Runtime reads avoid Google Sheets round trips:

- Storefront catalog reads active products from an indexed Supabase query and
  uses a 60 second Next.js cache.
- Admin order list reads orders and order items in two ordered queries, then
  joins in memory for the dashboard and list/detail pages.
- Tracking queries target normalized indexed columns and batch-load matching
  order items.
- Checkout performs one RPC call for the order and item write transaction.

## Rollback

Rollback now means redeploying a pre-cutover build. The current runtime has no
automatic Google Sheets fallback and does not dual-write.

Recommended rollback procedure:

1. Revert to the previous known-good deployment or commit.
2. Restore the Google Sheets variables in that rollback environment.
3. Leave Supabase data untouched for analysis.
4. Smoke test checkout, admin orders, product management, tracking, private slip
   upload, and public product image handling.

## Validation

Before merge, run:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm audit
npm run supabase:verify
```

`npm run supabase:verify` requires the optional Google Sheets migration
variables plus the Supabase service role key.
