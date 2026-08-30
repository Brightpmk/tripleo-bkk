import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import { updateAdminProductWithOptionalImage } from "@/lib/server/product-admin-operations";
import {
  parseProductPayload,
  productErrorResponse
} from "@/lib/server/admin-product-request";

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
