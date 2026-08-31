# KingGallery Admin Product Management

## Admin Architecture

`/admin` is rendered on the server and redirects unauthenticated requests to
`/admin/login`. Every product mutation checks the authenticated admin session
again before reading request bodies or contacting Supabase or Vercel Blob.

The credential boundaries are:

- Supabase service role for products, orders, and order items.
- Google Drive OAuth for private payment slips.
- Vercel Blob OIDC for product images.
- bcrypt password hash plus encrypted `iron-session` cookie for admin access.

Google Sheets is no longer used by product/order runtime code. It remains only
as optional migration and verification input for the Supabase scripts.

## Password Security

`ADMIN_PASSWORD_HASH` contains a bcrypt hash generated with cost factor 12. The
login route verifies the submitted password on the server with `bcryptjs`.
Neither the plaintext password nor its hash is sent to client code.

Generate a hash locally:

```powershell
npm run admin:hash-password
```

Store a separate high-entropy session secret as `ADMIN_SESSION_SECRET`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Production has no fallback secret and cannot authenticate if this value is
missing or shorter than 32 characters.

## Supabase Product Operations

The admin list reads from `public.products` and includes active and inactive
products. Staff can add and edit:

- immutable, unique `PRODUCT_ID`
- controlled `UNIVERSITY`
- arbitrary data-driven shirt color
- positive THB base price with at most two decimals
- selected `AVAILABLE_SIZES`
- `ACTIVE`
- non-negative whole-number `SORT_ORDER`
- uploaded product image URL

Creation checks uniqueness before upload and the database unique constraint
rechecks it at insert time. Editing and deletion target `PRODUCT_ID`; no client
supplied row number or database UUID is trusted.

Deleting a product removes only the product row. Historical `order_items` keep
their own color, size, quantity, unit price, and line total snapshots.

## Vercel Blob

Product image uploads authenticate with the OIDC flow supported by
`@vercel/blob`. Server code passes `BLOB_STORE_ID` to the SDK, and the SDK gets
the current Vercel OIDC token from the function context or `VERCEL_OIDC_TOKEN`.
No long-lived read/write Blob token is read by the application.

For replacement, the new Blob is uploaded first, Supabase is updated, and only
then is the previous Blob deleted on a best-effort basis. If the database write
fails, the new Blob is cleaned up. Cleanup failure can leave an orphan, but it
never rolls back the committed product change.

## Cache Behavior

The storefront catalog is cached for 60 seconds through the Next.js data cache.
Every successful create, update, or delete expires the catalog tag and the
storefront page so the next storefront or checkout read fetches Supabase.

## Environment Variables

Required production variables:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_SLIP_FOLDER_ID=
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
BLOB_STORE_ID=
```

Optional migration/recovery variables:

```text
GOOGLE_ORDER_SPREADSHEET_ID=
GOOGLE_ORDERS_RANGE=
GOOGLE_ORDER_ITEMS_RANGE=
GOOGLE_PRODUCTS_RANGE=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

## Local Setup

1. Run `npm install` or `npm ci` in a clean checkout.
2. Copy the production-runtime variables into untracked `.env.local`.
3. Add optional Google Sheets variables only when running the Supabase import or
   verification scripts.
4. Run `vercel link` and `vercel env pull .env.local` if you need the connected
   Blob store id and local Vercel OIDC token.
5. Run `npm run dev`, visit `/admin`, and smoke test product create, edit,
   deactivate, delete, and image replacement.

## Automated Coverage

The test suite uses mocked Supabase, Drive, and Blob clients. It covers auth,
CSRF, rate limiting, product validation, duplicate IDs, create/update/delete
operation ordering, safe Blob cleanup, image validation, catalog cache
invalidation, private slip access, admin order mutations, tracking privacy, and
client-secret scanning.
