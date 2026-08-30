import "server-only";

import { ProductAdminError } from "./product-admin-error";

export function parseProductPayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new ProductAdminError("Product details are required.");
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid product payload");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProductAdminError("Product details could not be read.");
  }
}

export function productErrorResponse(error: unknown) {
  if (error instanceof ProductAdminError) {
    return Response.json(
      {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors
      },
      { status: error.status }
    );
  }

  console.error("Admin product mutation failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return Response.json(
    { ok: false, message: "Product could not be saved." },
    { status: 500 }
  );
}
