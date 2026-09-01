import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import { createAdminProductWithImage } from "@/lib/server/product-admin-operations";
import {
  parseProductPayload,
  productErrorResponse
} from "@/lib/server/admin-product-request";
import { VERCEL_REQUEST_BODY_LIMIT_BYTES } from "@/lib/product-image-limits";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await hasValidAdminSession())) {
    return Response.json(
      { ok: false, message: "Authentication required." },
      { status: 401 }
    );
  }

  if (!isSameOriginRequest(request)) {
    return Response.json(
      { ok: false, message: "Request could not be verified." },
      { status: 403 }
    );
  }

  if (isRequestTooLarge(request)) {
    return Response.json(
      {
        ok: false,
        message:
          "That image is too large to upload. Pick the image again so it can be optimised, or resize it first."
      },
      { status: 413 }
    );
  }

  try {
    const formData = await request.formData();
    const product = parseProductPayload(formData.get("product"));
    const singleImage = formData.get("image");
    const multipleImages = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const filesToUpload =
      multipleImages.length > 0
        ? multipleImages
        : singleImage instanceof File && singleImage.size > 0
        ? [singleImage]
        : [];

    const saved = await createAdminProductWithImage(
      product,
      filesToUpload
    );

    return Response.json({ ok: true, product: saved }, { status: 201 });
  } catch (error) {
    return productErrorResponse(error);
  }
}

/**
 * Vercel rejects a body over its own cap with a platform 413 before this
 * handler runs; this only catches the narrow band just under it so the admin
 * gets an actionable message instead of a raw platform error.
 */
function isRequestTooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  return (
    Number.isFinite(contentLength) &&
    contentLength > VERCEL_REQUEST_BODY_LIMIT_BYTES
  );
}
