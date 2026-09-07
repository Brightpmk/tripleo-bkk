# Payment Slip Migration to Private Vercel Blob

## Architecture

New checkout flow:

```text
checkout -> signature and image decode validation
         -> VercelBlobSlipStorage (private store, Vercel OIDC)
         -> opaque blob:v1:payment-slips/... reference
         -> create_order_with_items RPC
```

`orders.slip_file_id` keeps its existing nullable text column. New rows store a
versioned opaque pathname reference, never a Blob URL. No Supabase migration is
required.

Product images remain in their existing public Blob store. Payment slips require
a separate private store because Vercel Blob access mode is fixed per store.
`BLOB_STORE_ID` remains the public product-image store;
`PAYMENT_SLIP_BLOB_STORE_ID` selects the private slip store. Both use Vercel's
short-lived runtime OIDC token. The application does not read
`BLOB_READ_WRITE_TOKEN`.

## Access Control

Private Blob objects cannot be fetched anonymously. The SDK upload and read calls
set `access: "private"`. The browser requests the existing authenticated admin
route by order ID. That route resolves the opaque reference server-side, reads the
private object with OIDC, and streams bytes with `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex, nofollow`, and the stored image MIME type. It never returns
the Blob URL, pathname, OIDC token, or store ID.

References must match this shape before a Blob read or deletion is attempted:

```text
blob:v1:payment-slips/{ORDER_ID}/{UUID}.{jpg|png|webp}
```

This prevents a corrupted database value from reading or deleting an arbitrary
Blob pathname. Names contain no customer name, phone, address, or other PII.

## Historical Drive Slips

The transition uses dual-read. New uploads always go to private Blob. Existing
unprefixed `slip_file_id` values continue through the historical Google Drive
reader and deleter. Drive is loaded only when one of those records is viewed or
deleted.

Keep the four Drive variables while historical references remain. Do not delete
old Drive files during this deployment. After private Blob is verified and old
files are migrated separately, remove the Drive fallback, OAuth helper, Google
dependency, and variables in a follow-up cleanup.

## Failure Semantics

- Blob upload failure: no order is written and the customer receives the existing
  generic retry response.
- Supabase persistence failure after upload: the new Blob is deleted best-effort.
- Permanent order deletion: Supabase order and items are deleted first; the stored
  slip is then deleted best-effort from Blob or Drive according to its reference.
- Slip cleanup failure: deletion remains successful and the admin receives the
  existing non-blocking warning.

Logs include only operation, order ID, recognized safe codes, and fixed messages.
They do not include customer details, slip references, storage URLs, or secrets.

## Environment

Required production runtime:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSWORD_HASH
ADMIN_SESSION_SECRET
BLOB_STORE_ID
PAYMENT_SLIP_BLOB_STORE_ID
```

The Vercel project must be connected to both Blob stores with OIDC enabled. Create
the payment-slip store as **Private**; a public store cannot be converted to or
used as private storage.

Optional during historical transition:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
```

Safe to remove after every historical Drive reference has been migrated and
verified:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
```

`GOOGLE_DRIVE_SLIP_FOLDER_ID` is safe to remove immediately because historical
reads and deletes use the stored Drive file ID directly.

Google Sheets import variables remain migration-only and unrelated to slip storage.

## Preview and Production Checklist

1. Create a private Vercel Blob store and connect it to the Vercel project using
   OIDC.
2. Set `PAYMENT_SLIP_BLOB_STORE_ID` to that private store's ID in Preview.
3. Deploy this branch to Preview.
4. Submit a checkout with a JPEG, PNG, or WEBP slip and confirm the order succeeds.
5. Confirm `orders.slip_file_id` starts with `blob:v1:payment-slips/` and contains
   no URL.
6. Confirm the object appears in the private store and its direct Blob URL rejects
   anonymous access.
7. Open the order as an authenticated admin and confirm the slip renders.
8. Call public tracking and confirm no slip reference, pathname, URL, address, or
   admin payment data appears.
9. Delete the test order and confirm its Blob object is removed.
10. Open one historical Drive-backed order to verify transition access.
11. Promote to Production, set the private store ID there, and repeat steps 4-9.
12. Remove or revoke Drive variables only after historical references have been
   migrated and verified; place another order to confirm no new Drive dependency.

No Supabase migration or database push command is needed for this cutover.
