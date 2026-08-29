import "server-only";

import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import type { ConfirmedOrder } from "@/lib/orders";
import type { Product } from "@/lib/catalog";
import { appendOrderRows } from "./google-sheets";
import { createServerOrderId } from "./order-id";
import { mapOrderToSheetRows } from "./order-row-mapper";
import { validateOrderSubmission } from "./order-validation";
import {
  GoogleDriveSlipStorage,
  type PaymentSlipStorage
} from "./payment-slip-storage";
import { validatePaymentSlipUpload } from "./payment-slip-validation";
import { getCachedProductCatalog } from "./product-catalog";

const recentSubmissions = new Map<string, Promise<OrderSubmissionResult>>();
const SUBMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export type OrderServiceDependencies = {
  appendRows?: typeof appendOrderRows;
  getProductCatalog?: () => Promise<Product[]>;
  slipStorage?: PaymentSlipStorage;
};

export async function submitOrderWithSlip(
  request: OrderSubmissionRequest,
  slipFile: File | null,
  dependencies: OrderServiceDependencies = {}
): Promise<OrderSubmissionResult> {
  const submissionKey =
    typeof request.submissionKey === "string" && request.submissionKey.length > 0
      ? request.submissionKey
      : undefined;

  if (submissionKey && recentSubmissions.has(submissionKey)) {
    return recentSubmissions.get(submissionKey)!;
  }

  const submission = persistOrder(request, slipFile, dependencies);

  if (submissionKey) {
    recentSubmissions.set(submissionKey, submission);
    submission.then((result) => {
      if (!result.ok) {
        recentSubmissions.delete(submissionKey);
        return;
      }

      setTimeout(
        () => recentSubmissions.delete(submissionKey),
        SUBMISSION_CACHE_TTL_MS
      );
    });
  }

  return submission;
}

async function persistOrder(
  request: OrderSubmissionRequest,
  slipFile: File | null,
  dependencies: OrderServiceDependencies
): Promise<OrderSubmissionResult> {
  const getProductCatalog =
    dependencies.getProductCatalog ?? getCachedProductCatalog;
  let products: Product[];

  try {
    products = await getProductCatalog();
  } catch (error) {
    console.error("Product catalog load failed before order validation", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    return {
      ok: false,
      message:
        "Product catalog is unavailable right now. Please try again in a moment."
    };
  }

  const validation = validateOrderSubmission(request, products);

  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message,
      fieldErrors: validation.fieldErrors
    };
  }

  const slipValidation = await validatePaymentSlipUpload(slipFile);

  if (!slipValidation.ok) {
    return {
      ok: false,
      message: slipValidation.message
    };
  }

  const now = new Date();
  const slipStorage = dependencies.slipStorage ?? new GoogleDriveSlipStorage();
  const appendRows = dependencies.appendRows ?? appendOrderRows;
  let uploadedSlipFileId: string | null = null;

  const order: ConfirmedOrder = {
    ...validation.order,
    orderId: createServerOrderId(now),
    createdAtIso: now.toISOString(),
    paymentStatus: "pending"
  };

  try {
    const uploadedSlip = await slipStorage.upload({
      ...slipValidation.slip,
      orderId: order.orderId,
      createdAt: now
    });
    uploadedSlipFileId = uploadedSlip.fileId;

    await appendRows(
      mapOrderToSheetRows({
        ...order,
        slipFileId: uploadedSlip.fileId
      })
    );
  } catch (error) {
    if (uploadedSlipFileId) {
      try {
        await slipStorage.delete(uploadedSlipFileId);
      } catch (cleanupError) {
        console.error("Payment slip cleanup failed", {
          orderId: order.orderId,
          errorName:
            cleanupError instanceof Error ? cleanupError.name : "UnknownError"
        });
      }
    }

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
