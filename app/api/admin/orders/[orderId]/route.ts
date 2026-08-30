import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import {
  OrderSheetError,
  updateAdminOrder
} from "@/lib/server/order-admin-service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
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

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, message: "Order update could not be read." },
      { status: 400 }
    );
  }

  try {
    const { orderId } = await context.params;
    const order = await updateAdminOrder(orderId, payload);

    return Response.json({ ok: true, order });
  } catch (error) {
    return orderErrorResponse(error, "Order could not be updated.");
  }
}

/**
 * Google API internals never reach the browser: a known OrderSheetError
 * carries its own safe message, anything else becomes a flat 500 and only the
 * error's class name is logged.
 */
function orderErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof OrderSheetError) {
    return Response.json(
      { ok: false, message: error.message },
      { status: error.status }
    );
  }

  console.error("Admin order mutation failed", {
    errorName: error instanceof Error ? error.name : "UnknownError"
  });

  return Response.json({ ok: false, message: fallbackMessage }, { status: 500 });
}
