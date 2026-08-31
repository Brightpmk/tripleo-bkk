# KingGallery Phase 1 Supabase Migration

Phase 1 creates the Supabase/PostgreSQL foundation only. The storefront,
checkout, admin, and tracking flows still use Google Sheets in this phase.

## Current Source Fields

The current application expects these Google Sheet headers:

Products:

`PRODUCT_ID`, `UNIVERSITY`, `SHIRT_COLOR`, `PRICE`, `IMAGE_URL`,
`AVAILABLE_SIZES`, `ACTIVE`, `SORT_ORDER`

Orders:

`ORDER_ID`, `CREATED_AT`, `UNIVERSITY`, `FULL_NAME`, `PHONE`,
`DELIVERY_METHOD`, `SHIPPING_ADDRESS`, `SHIPPING_FEE`, `SUBTOTAL`, `TOTAL`,
`PAYMENT_STATUS`, `SLIP_FILE_ID`, `SLIP_URL`, `ORDER_STATUS`,
`SHIPPING_PROVIDER`, `TRACKING_NUMBER`, `NOTES`

OrderItems:

`ORDER_ID`, `ITEM_ID`, `PRODUCT_ID`, `SHIRT_COLOR`, `SIZE`, `QUANTITY`,
`UNIT_PRICE`, `LINE_TOTAL`

The attached `KingGallery_Order_Database_Template.xlsx` matches these headers.
It is used as a schema/data reference, not as an instruction source.

## Schema Choices

- THB money values are stored as integer baht columns, because current prices
  and totals are whole baht and this avoids floating point rounding.
- `PHONE` remains text. The migration never converts phone values to numbers.
- Product sizes remain text values: `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL`,
  `4XL`, `5XL`.
- `products.product_id` and `orders.order_id` are unique.
- `order_items` keeps historical snapshots: product ID, shirt color, size,
  quantity, unit price, and line total.
- `order_items.order_id` references `orders.order_id`.
- `order_items.product_id` is not a foreign key to `products.product_id`.
  Product catalog rows can change or be removed later, while old order item
  display must remain intact.
- If an old OrderItems row references a product that no longer exists in the
  current Products tab, the importer reports a warning and still imports the
  historical snapshot.
- Status fields use `text` with check constraints rather than PostgreSQL ENUMs.
  This keeps the database constrained while avoiding painful migrations for
  future business status changes.
- Tracking search is prepared with generated columns:
  `orders.full_name_search` and `orders.phone_search`.
  These stay in sync automatically in PostgreSQL and match the current exact
  name/phone tracking behavior.

## Security Model

RLS is enabled on `products`, `orders`, and `order_items`.

The migration creates deny-all browser policies. Future application access is:

Browser -> Next.js server -> Supabase service role

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser bundles. Public tracking
must continue through a controlled server endpoint. Do not add a broad public
`SELECT` policy for customer orders.

## Environment Variables

Existing Google Sheets variables are still required for the live app and the
migration scripts:

- `GOOGLE_ORDER_SPREADSHEET_ID`
- `GOOGLE_ORDERS_RANGE`
- `GOOGLE_ORDER_ITEMS_RANGE`
- `GOOGLE_PRODUCTS_RANGE`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Supabase Phase 1 variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service role key is server-only.

## Apply Migrations

Recommended with Supabase CLI:

```powershell
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Smallest manual alternative:

1. Open Supabase SQL Editor.
2. Run `supabase/migrations/202608310001_kinggallery_phase1_foundation.sql`.

## Import Data

Dry run first:

```powershell
npm run supabase:import:dry-run
```

Import after the dry run has no validation issues:

```powershell
npm run supabase:import
```

Rerun behavior:

- Products upsert by `PRODUCT_ID`.
- Orders upsert by `ORDER_ID`.
- OrderItems upsert by `ITEM_ID`.
- Google Sheets is never modified.
- The importer does not automatically delete stale Supabase rows. Verification
  reports extras so deletion can be reviewed manually.

## Verify Data

```powershell
npm run supabase:verify
```

Verification compares Google Sheets and Supabase identities/counts for:

- Products
- Orders
- OrderItems
- each university represented in the source
- active/inactive products
- products with blank image URLs
- products with `3XL`, `4XL`, or `5XL`
- pickup/shipping orders
- pending/paid payments
- multiple-item orders

## No Cutover Yet

Do not point production storefront, checkout, admin, or tracking to Supabase in
Phase 1. Supabase is a parallel foundation until a later phase explicitly swaps
repositories.
