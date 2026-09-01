import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import { productErrorResponse } from "@/lib/server/admin-product-request";
import { VERCEL_REQUEST_BODY_LIMIT_BYTES } from "@/lib/product-image-limits";
import {
  addProductImages,
  removeProductImage,
  reorderProductImages
} from "@/lib/server/product-image-operations";
import { listProductImages } from "@/lib/server/supabase/product-image-repository";

export const runtime = "nodejs";

/** Every handler here is admin-only and same-origin, like the product API. */
async function guard(request: Request) {
  if (!(await hasValidAdminSession())) {
    return Response.json(
      { ok: false, message: "Authentication required." },
      { status: 401 }
    );
  }

  if (request.method !== "GET" && !isSameOriginRequest(request)) {
    return Response.json(
      { ok: false, message: "Request could not be verified." },
      { status: 403 }
    );
  }

  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { productId } = await context.params;
    return Response.json({ ok: true, images: await listProductImages(productId) });
  } catch (error) {
    return productErrorResponse(error, "Product images could not be loaded.");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
  const denied = await guard(request);
  if (denied) return denied;

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (
    Number.isFinite(contentLength) &&
    contentLength > VERCEL_REQUEST_BODY_LIMIT_BYTES
  ) {
    return Response.json(
      {
        ok: false,
        message:
          "Those images are too large to upload together. Add fewer at a time."
      },
      { status: 413 }
    );
  }

  try {
    const { productId } = await context.params;
    const formData = await request.formData();
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File);

    const result = await addProductImages(productId, files);

    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return productErrorResponse(error, "The images could not be uploaded.");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { productId } = await context.params;
    const payload = (await request.json()) as { imageUrls?: unknown };
    const imageUrls = Array.isArray(payload.imageUrls)
      ? payload.imageUrls.filter(
          (value): value is string => typeof value === "string"
        )
      : [];

    const result = await reorderProductImages(productId, imageUrls);

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return productErrorResponse(error, "Image order could not be saved.");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ productId: string }> }
) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const { productId } = await context.params;
    const payload = (await request.json()) as { imageUrl?: unknown };
    const imageUrl =
      typeof payload.imageUrl === "string" ? payload.imageUrl : "";

    const result = await removeProductImage(productId, imageUrl);

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return productErrorResponse(error, "The image could not be removed.");
  }
}
