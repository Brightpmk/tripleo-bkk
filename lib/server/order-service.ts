import "server-only";

import type {
  OrderSubmissionRequest,
  OrderSubmissionResult
} from "@/lib/order-submission";
import type { ConfirmedOrder } from "@/lib/orders";
import type { Product } from "@/lib/catalog";
import { appendOrderRows, prefetchOrderSheetIds } from "./google-sheets";
import { createServerOrderId } from "./order-id";
import { mapOrderToSheetRows } from "./order-row-mapper";
import { validateOrderSubmission } from "./order-validation";
import {
  GoogleDriveSlipStorage,
  type PaymentSlipStorage
} from "./payment-slip-storage";
import { validatePaymentSlipUpload } from "./payment-slip-validation";
import { getCachedProductCatalog } from "./product-catalog";
import { createPhaseTimer, logOrderTiming } from "./timing";

const recentSubmissions = new Map<string, Promise<OrderSubmissionResult>>();
const SUBMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

export type OrderServiceDependencies = {
  appendRows?: typeof appendOrderRows;
  getProductCatalog?: () => Promise<Product[]>;
  slipStorage?: PaymentSlipStorage;
  prefetchSheets?: () => Promise<void>;
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
  const timer = createPhaseTimer();
  const getProductCatalog =
    dependencies.getProductCatalog ?? getCachedProductCatalog;
  const prefetchSheets = dependencies.prefetchSheets ?? prefetchOrderSheetIds;

  // Three independent reads, none of which mutate anything:
  //   - the canonical catalog (network)
  //   - decoding and sniffing the slip bytes (CPU)
  //   - warming the Sheets auth token and tab IDs (network)
  // Running them together removes two full round trips from the wait.
  // The warm-up never rejects, so it cannot fail the order.
  const catalogRead = timer.track("catalogMs", getProductCatalog());
  const slipRead = timer.track("slipDecodeMs", validatePaymentSlipUpload(slipFile));
  const sheetsWarmup = timer.track("sheetsWarmupMs", prefetchSheets());

  let products: Product[];

  try {
    products = await catalogRead;
  } catch (error) {
    await settle(slipRead, sheetsWarmup);
    console.error("Product catalog load failed before order validation", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    logOrderTiming(timer, { outcome: "catalog-unavailable" });

    return {
      ok: false,
      message:
        "Product catalog is unavailable right now. Please try again in a moment."
    };
  }

  const validation = validateOrderSubmission(request, products);
  timer.mark("validateMs");

  if (!validation.ok) {
    await settle(slipRead, sheetsWarmup);
    logOrderTiming(timer, { outcome: "invalid-order" });

    return {
      ok: false,
      message: validation.message,
      fieldErrors: validation.fieldErrors
    };
  }

  const slipValidation = await slipRead;

  if (!slipValidation.ok) {
    await settle(sheetsWarmup);
    logOrderTiming(timer, { outcome: "invalid-slip" });

    return {
      ok: false,
      message: slipValidation.message
    };
  }

  // Everything above is read-only. Past this point we start writing, so the
  // warm-up must be finished before the append can benefit from it.
  await settle(sheetsWarmup);

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
    const uploadedSlip = await timer.track(
      "slipUploadMs",
      slipStorage.upload({
        ...slipValidation.slip,
        orderId: order.orderId,
        createdAt: now
      })
    );
    uploadedSlipFileId = uploadedSlip.fileId;

    await timer.track(
      "sheetsWriteMs",
      appendRows(
        mapOrderToSheetRows({
          ...order,
          slipFileId: uploadedSlip.fileId
        })
      )
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
    logOrderTiming(timer, {
      orderId: order.orderId,
      slipBytes: slipValidation.slip.buffer.byteLength,
      outcome: "persistence-failed"
    });

    return {
      ok: false,
      message:
        "We could not save your order right now. Please try again in a moment."
    };
  }

  logOrderTiming(timer, {
    orderId: order.orderId,
    slipBytes: slipValidation.slip.buffer.byteLength,
    outcome: "accepted"
  });

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

/**
 * Awaits already-started work purely so it cannot become an unhandled
 * rejection on an early-return path. Results and errors are discarded.
 */
async function settle(...work: Promise<unknown>[]) {
  await Promise.allSettled(work);
}
