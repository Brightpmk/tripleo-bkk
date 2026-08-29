"use server";

import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import { submitOrderToSheets } from "@/lib/server/order-service";

export async function submitOrderAction(
  request: OrderSubmissionRequest
): Promise<OrderSubmissionResult> {
  return submitOrderToSheets(request);
}
