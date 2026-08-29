import "server-only";

import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import type { ConfirmedOrder } from "@/lib/orders";
import { appendOrderRows } from "./google-sheets";
import { createServerOrderId } from "./order-id";
import { mapOrderToSheetRows } from "./order-row-mapper";
import { validateOrderSubmission } from "./order-validation";

const recentSubmissions = new Map<string, Promise<OrderSubmissionResult>>();
const SUBMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export async function submitOrderToSheets(
  request: OrderSubmissionRequest
): Promise<OrderSubmissionResult> {
  const submissionKey =
    typeof request.submissionKey === "string" && request.submissionKey.length > 0
      ? request.submissionKey
      : undefined;

  if (submissionKey && recentSubmissions.has(submissionKey)) {
    return recentSubmissions.get(submissionKey)!;
  }

  const submission = persistOrder(request);

  if (submissionKey) {
    recentSubmissions.set(submissionKey, submission);
    submission.finally(() => {
      setTimeout(() => recentSubmissions.delete(submissionKey), SUBMISSION_CACHE_TTL_MS);
    });
  }

  return submission;
}

async function persistOrder(
  request: OrderSubmissionRequest
): Promise<OrderSubmissionResult> {
  const validation = validateOrderSubmission(request);

  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message,
      fieldErrors: validation.fieldErrors
    };
  }

  const now = new Date();
  const order: ConfirmedOrder = {
    ...validation.order,
    orderId: createServerOrderId(now),
    createdAtIso: now.toISOString(),
    paymentStatus: "pending"
  };

  try {
    await appendOrderRows(mapOrderToSheetRows(order));
  } catch (error) {
    console.error("Order persistence failed", {
      orderId: order.orderId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    return {
      ok: false,
      message:
        "We could not save your order right now. Please try again in a moment."
    };
  }

  return {
    ok: true,
    order: {
      orderId: order.orderId,
      createdAtIso: order.createdAtIso,
      universityId: order.universityId,
      itemSubtotalThb: order.itemSubtotalThb,
      shippingFeeThb: order.shippingFeeThb,
      finalTotalThb: order.finalTotalThb,
      paymentStatus: order.paymentStatus
    }
  };
}
