import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import {
  deleteAdminProductWithImageCleanup,
  updateAdminProductWithOptionalImage
} from "@/lib/server/product-admin-operations";
import {
  parseProductPayload,
  productErrorResponse
} from "@/lib/server/admin-product-request";
import { VERCEL_REQUEST_BODY_LIMIT_BYTES } from "@/lib/product-image-limits";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
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
    const { productId } = await context.params;
    const formData = await request.formData();
    const product = parseProductPayload(formData.get("product"));
    const image = formData.get("image");
    const saved = await updateAdminProductWithOptionalImage(
      productId,
      product,
      image instanceof File ? image : null
    );

    return Response.json({ ok: true, product: saved });
  } catch (error) {
    return productErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
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

  try {
    const { productId } = await context.params;
    const { product, imageCleanup } =
      await deleteAdminProductWithImageCleanup(productId);

    return Response.json({
      ok: true,
      productId: product.productId,
      imageCleanup,
      // Non-blocking: the product is gone either way.
      ...(imageCleanup === "failed"
        ? {
            warning:
              "Product deleted, but its image could not be removed from storage."
          }
        : {})
    });
  } catch (error) {
    return productErrorResponse(error, "Product could not be deleted.");
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
