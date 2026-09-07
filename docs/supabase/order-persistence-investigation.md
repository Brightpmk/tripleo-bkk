# Order persistence investigation: 2026-09-07

## Finding and limits

The locally configured Google Drive OAuth refresh fails with HTTP 400,
`invalid_grant`. This happens before slip upload and before Supabase persistence.
The existing `Order persistence failed` catch covers both operations; its old
`errorName: Error` output cannot identify which failed.

The production incident `KG-2026-46B876B5` cannot be attributed conclusively from
that log alone. Vercel's credentials were not inspected or compared with local
credentials. The Drive failure explains production if it uses the same rejected
OAuth credentials. No failing Supabase constraint was reproduced.

## Live database checks

The local SUPABASE_URL matches the CLI-linked project. Inspected its live RPC,
constraints, API schema (including required fields), privileges, and migration
history without reading customer fields.

- RPC: `public.create_order_with_items(p_order jsonb, p_items jsonb)`, returns
  `public.orders`, security invoker, search_path public. Matches the migration.
- Runtime supplies all 16 order inputs consumed by the RPC and all seven item
  inputs. The RPC adds each item's order_id and created_at from the inserted order.
- Payment values: pending, verified, review_required, rejected. Runtime: pending.
- Order values: new, preparing, shipped, completed, cancelled. Runtime: new.
- Universities: MAHASARAKHAM, BANGKOK THONBURI, RAMKHAMHAENG, MAE FAH LUANG,
  MAEJO, BANGMOD, NORTH BANGKOK, LADKRABANG. Match catalog canonical values.
- Sizes: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL. Match runtime sizes.
- orders.order_id is unique; item_id and (order_id, item_id) are unique.
  Generated `KG-2026-XXXXXXXX` and suffixed item IDs satisfy format constraints.
- No order or items currently exist for KG-2026-46B876B5. This does not prove
  there was no transient collision at the time of the incident.
- Order customer name and phone must be nonempty. Shipping requires an address.
  Fees/totals must be nonnegative. Runtime validation supplies these fields.
- Optional address/slip/provider/tracking/notes fields are nullable; the RPC
  converts their empty strings to NULL. All required runtime fields are supplied.
- Item product/color must be nonempty, quantity and unit price positive, and
  line total nonnegative. Product ID is a snapshot, without a product foreign key.
  The item order foreign key refers to the order inserted in the same transaction.
- service_role has RPC EXECUTE, orders SELECT/INSERT and order_items INSERT.
- Applied migrations: 202608310001 (foundation), 20260831100828 (runtime RPC),
  20260901120000 (product images), 20260902090000 (order deletion).
  The later migrations do not alter order insertion constraints or its RPC.

## Reproduction

A synthetic BANGMOD, M, pickup, pending/new order with one item was inserted by
the live RPC under `SET LOCAL ROLE service_role` inside BEGIN/ROLLBACK. The call
succeeded. Follow-up counts confirmed zero diagnostic orders and items remained.
No Drive upload or customer record was involved.

An HTTPS call using the configured service key and `{p_order: {}, p_items: []}`
reached the RPC's deliberate `order_items_required` guard (23514). This verifies
the API signature and invocation access without inserting any rows. This expected
guard error is not the production incident.

A separate OAuth refresh using the local Drive client returned `invalid_grant`
(HTTP 400). No access token, refresh token, client secret, or slip ID was logged.

## Diagnostics and remediation

The service now logs orderId, operation, recognized error codes, and fixed safe
descriptions. Raw database message/details/hint are intentionally excluded:
Postgres errors can contain complete failing customer rows. Customer responses,
HTTP statuses, cleanup, payloads, and payment behavior are unchanged.

To repair the reproduced Drive failure, reauthorize the owner with `npm run
drive:oauth`, then update GOOGLE_DRIVE_REFRESH_TOKEN in local and Vercel production
environment settings using the matching OAuth client ID/secret. Redeploy Vercel
for the environment change and diagnostic code. No schema migration or db push
is indicated by this investigation. No credentials or database schema were changed.

Check whether the Google OAuth app is still External/Testing before reauthorizing.
Google documents a seven-day refresh-token lifetime for that configuration when
using Drive scopes. Expiration versus revocation was not established here.

Reference: https://developers.google.com/identity/protocols/oauth2#expiration
