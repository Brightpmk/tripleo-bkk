/**
 * Product image byte limits, shared by the browser and the server.
 *
 * Kept out of lib/server/product-image.ts because that module is
 * `server-only`; the admin form needs the same numbers to size its
 * client-side optimisation pass.
 */

/**
 * Hard ceiling for bytes that actually reach the upload API.
 *
 * Vercel Functions reject any request body over 4.5 MB with a platform-level
 * 413 (FUNCTION_PAYLOAD_TOO_LARGE) before application code runs, so this sits
 * just under that. It is NOT the limit the admin experiences — the browser
 * downscales a source of up to MAX_PRODUCT_IMAGE_SOURCE_BYTES below this
 * first.
 */
export const MAX_PRODUCT_IMAGE_BYTES = 4_400_000;

/** Vercel's platform request-body cap. Requests above this never arrive. */
export const VERCEL_REQUEST_BODY_LIMIT_BYTES = 4_500_000;
