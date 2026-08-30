import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import { MAX_SLIP_FILE_SIZE_BYTES } from "@/lib/slip";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";
import { submitOrderWithSlip } from "@/lib/server/order-service";

export const runtime = "nodejs";
const MAX_ORDER_REQUEST_BYTES = MAX_SLIP_FILE_SIZE_BYTES + 512 * 1024;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      {
        ok: false,
        message: "Order request could not be verified."
      } satisfies OrderSubmissionResult,
      { status: 403 }
    );
  }

  if (isRequestTooLarge(request)) {
    return Response.json(
      {
        ok: false,
        message: "The slip image must be 5 MB or smaller."
      } satisfies OrderSubmissionResult,
      { status: 413 }
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      {
        ok: false,
        message: "Order details could not be read."
      } satisfies OrderSubmissionResult,
      { status: 400 }
    );
  }

  const orderPayload = formData.get("order");
  const slipFile = formData.get("slip");

  if (typeof orderPayload !== "string") {
    return Response.json(
      {
        ok: false,
        message: "Order details are required."
      } satisfies OrderSubmissionResult,
      { status: 400 }
    );
  }

  let parsedRequest: OrderSubmissionRequest;

  try {
    parsedRequest = JSON.parse(orderPayload) as OrderSubmissionRequest;
  } catch {
    return Response.json(
      {
        ok: false,
        message: "Order details could not be read."
      } satisfies OrderSubmissionResult,
      { status: 400 }
    );
  }

  const result = await submitOrderWithSlip(
    parsedRequest,
    slipFile instanceof File ? slipFile : null
  );

  return Response.json(result, { status: result.ok ? 200 : 400 });
}

function isRequestTooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  return Number.isFinite(contentLength) && contentLength > MAX_ORDER_REQUEST_BYTES;
}
