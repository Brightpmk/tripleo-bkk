import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import { createAdminProductWithImage } from "@/lib/server/product-admin-operations";
import {
  parseProductPayload,
  productErrorResponse
} from "@/lib/server/admin-product-request";

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

  try {
    const formData = await request.formData();
    const product = parseProductPayload(formData.get("product"));
    const image = formData.get("image");
    const saved = await createAdminProductWithImage(
      product,
      image instanceof File ? image : null
    );

    return Response.json({ ok: true, product: saved }, { status: 201 });
  } catch (error) {
    return productErrorResponse(error);
  }
}
