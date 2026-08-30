# KingGallery Admin Product Management

## Admin architecture

The public storefront remains unchanged. `/admin` is rendered on the server and
redirects unauthenticated requests to `/admin/login`. Every product mutation
checks the same authenticated session again before reading request bodies or
contacting Google Sheets or Vercel Blob.

The four credential boundaries remain separate:

- Google Sheets product and order access uses the existing service account.
- Payment-slip Drive access uses the existing store-owner OAuth credentials.
- Product images use the connected Vercel Blob store through Vercel OIDC.
- Admin access uses a bcrypt password hash and an encrypted server-verified
  session cookie.

## Password security

`ADMIN_PASSWORD_HASH` contains a bcrypt hash generated with cost factor 12. The
login route verifies the submitted password on the server with `bcryptjs`.
Neither the plaintext password nor its hash is sent to client code.

Generate a hash locally from an interactive terminal:

```powershell
npm run admin:hash-password
```

The command prompts twice without echoing the password, requires at least 12
characters, and prints only the final `ADMIN_PASSWORD_HASH=...` assignment.
Copy that assignment into `.env.local` or Vercel Environment Variables. The
utility does not write any file.

## Session security

`iron-session` encrypts and authenticates the session cookie with
`ADMIN_SESSION_SECRET`. The cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`,
and `Secure` in production. It expires after eight hours; the encrypted payload
also contains an explicit expiry that is checked on every protected request.
Logout destroys the cookie. Invalid, expired, tampered, or unconfigured sessions
fail closed.

Generate a separate high-entropy session secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Store the output only as `ADMIN_SESSION_SECRET` in `.env.local` and Vercel. Do
not reuse the admin password. Production has no fallback secret and cannot
authenticate if this value is missing or shorter than 32 characters.

## Login protection and CSRF

Login failures are limited to five attempts per source IP in a rolling
15-minute window. Successful authentication clears that source's counter. The
map is bounded and periodically pruned.

This limiter is process-local. It prevents unlimited rapid attempts against one
warm instance, but Vercel may run multiple instances or recycle them. A shared
rate-limit provider would be needed for a strict global limit; Redis was not
added for this store-sized implementation.

All login, logout, create, and update requests require an exact same-origin
`Origin` header. This check works with the `SameSite=Lax` session cookie to
prevent cross-site mutation requests. API handlers independently verify the
server session and return `401` before parsing an unauthenticated upload.

## Vercel Blob

Product image uploads authenticate with the OIDC flow supported by
`@vercel/blob` 2.8.0. Server code passes the connected store id to the SDK, and
the SDK obtains the current Vercel OIDC token from the Vercel function context
or `VERCEL_OIDC_TOKEN`. No read-write Blob token is read by the application.

The required store identifier is:

```text
BLOB_STORE_ID
```

Connecting the Blob store to the Vercel project supplies `BLOB_STORE_ID` and
OIDC identity to Vercel deployments. For local development, use the linked
Vercel project rather than creating a permanent static Blob token:

```powershell
vercel link
vercel env pull .env.local
npm run dev
```

Alternatively, run through the Vercel runtime so the OIDC token is minted for
local requests:

```powershell
vercel link
vercel dev
```

Locally pulled OIDC tokens are short-lived. If Blob uploads begin failing with
credential errors after time has passed, refresh the local environment with
`vercel env pull .env.local` or restart `vercel dev`. Never prefix
`BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN`, or any Blob credential with
`NEXT_PUBLIC_`.

Uploads accept PNG, JPEG, and WEBP files up to 4 MB. The server checks both MIME
type and file signature, ignores the original filename, and generates paths in
this form:

```text
products/<PRODUCT_ID>/<timestamp>-<random-id>.<controlled-extension>
```

For replacement, the new Blob is uploaded first, the Products row is updated,
and only then is the previous Vercel Blob deleted on a best-effort basis. A
failed Sheet update attempts to clean up the newly uploaded Blob. Cleanup
failure can leave an orphan, but never breaks the product's current image.

## Product operations

The admin list includes active and inactive products and supports university and
status filters. Staff can add and edit products using these fields:

- immutable, unique `PRODUCT_ID`
- controlled `UNIVERSITY`: `BANGMOD`, `LADKRABANG`, or `NORTH BANGKOK`
- arbitrary data-driven `JERSEY_COLOR`
- positive THB `PRICE` with at most two decimals
- selected `AVAILABLE_SIZES` in the existing comma-separated format
- `ACTIVE` as `TRUE` or `FALSE`
- non-negative whole-number `SORT_ORDER`
- uploaded `IMAGE_URL`

Creation checks uniqueness before upload and rechecks at append time. Editing
finds the current row by `PRODUCT_ID`; no client-supplied row number is used.
Deactivation is the retirement mechanism, so historical order references remain
understandable. The existing server-side catalog still provides canonical price,
size, university, and active-state checks during checkout.

Google Sheets is not transactional. Concurrent edits to the same product are
last-write-wins, but unrelated rows are never replaced and the whole Products
sheet is never rewritten.

## Cache behavior

The catalog remains cached for 60 seconds through the Next.js data cache. Every
successful create or edit explicitly expires the catalog tag and the storefront
page, so the next storefront or checkout read fetches the new Sheet values
without waiting for the normal TTL.

## Environment variables

New required server-only variables, without values:

```text
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
BLOB_STORE_ID=
```

The existing Google Sheets service-account and Drive OAuth variables remain
unchanged. `VERCEL_OIDC_TOKEN` is supplied by Vercel runtime or Vercel CLI
local tooling and is not a long-lived application setting. `.env.example`
contains placeholders only.

## Local setup

1. Run `npm install` (or `npm ci` in a clean checkout).
2. Copy the existing Google Sheets and Drive OAuth development credentials into
   the untracked `.env.local` file.
3. Run `npm run admin:hash-password` and place its output in `.env.local`.
4. Generate `ADMIN_SESSION_SECRET` with the command above and add it to
   `.env.local`.
5. Run `vercel link` if the checkout is not already linked, then run
   `vercel env pull .env.local` to populate the connected Blob store id and
   current Vercel OIDC token.
6. Run `npm run dev`, visit `/admin`, and complete the manual checks below.

## Production setup

1. Add `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` to the appropriate
   Vercel production and preview environments.
2. Confirm the existing public Blob store is connected to the same project and
   provides `BLOB_STORE_ID` and Vercel OIDC identity to those environments.
3. Confirm the existing Google Sheets service-account and Drive OAuth variables
   remain configured.
4. Redeploy once to apply the new variables and routes. Later product changes do
   not require deployment.

## Manual integration checks

These checks require real local credentials and were not run by the automated
suite:

1. Visit `/admin` logged out and confirm redirect to `/admin/login`.
2. Confirm wrong-password feedback, correct login, refresh persistence, and
   logout.
3. Add a product with a new JerseyColor and PNG, JPEG, then WEBP images.
4. Confirm the public Blob URL is written to `Products.IMAGE_URL` and the active
   product appears without a deployment.
5. Change the price and confirm checkout uses the updated canonical Sheet price.
6. Set `ACTIVE` to false and confirm the product disappears and checkout rejects
   it.
7. Restart the development server and confirm the encrypted cookie remains valid
   until its eight-hour expiry while the same session secret is configured.

## Highest-risk files for review

- `lib/server/admin-auth.ts`: password verification and session cookie settings
- `lib/server/admin-request-security.ts`: same-origin and rate-limit decisions
- `app/api/admin/login/route.ts`: login response and session establishment
- `app/api/admin/products/route.ts`: create authorization before upload parsing
- `app/api/admin/products/[productId]/route.ts`: edit authorization and ID lookup
- `lib/server/product-admin-operations.ts`: upload/write/cleanup ordering
- `lib/server/product-image.ts`: file validation and Blob credential boundary
- `lib/server/google-sheets.ts`: duplicate detection and row-targeted writes
- `lib/server/product-catalog.ts`: storefront and checkout cache invalidation
- `lib/server/env.ts`: server-only credential validation

## Automated coverage

The test suite uses mocked Sheets and Blob clients and no live production
services. It covers correct/incorrect passwords, live/expired/tampered sessions,
logout destruction, same-origin enforcement, rate limiting, unauthenticated
upload rejection, all product validation rules, duplicate IDs, create/edit and
deactivation flows, arbitrary colors, safe Blob path generation, image signature
checks, row-targeted writes, cache invalidation, and client-secret scanning.
