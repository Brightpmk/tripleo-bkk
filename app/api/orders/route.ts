import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import { submitOrderWithSlip } from "@/lib/server/order-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
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
