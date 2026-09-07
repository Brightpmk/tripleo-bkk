import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  calculateDashboardMetrics,
  MAX_SHIPPING_PROVIDER_LENGTH,
  MAX_TRACKING_NUMBER_LENGTH,
  orderStatuses,
  paymentStatuses,
  sortAdminOrders,
  type AdminDashboardMetrics,
  type AdminOrderDetail,
  type AdminOrderPatch,
  type AdminOrderStatus,
  type AdminOrderSummary
} from "@/lib/orders-admin";
import type { PaymentStatus } from "@/lib/orders";
import { OrderAdminError } from "./order-admin-error";
import { toOrderSummary, type AdminOrderRepository } from "./order-repository";
import { SupabaseOrderRepository } from "./supabase/order-repository";

/**
 * Admin-only cache. Deliberately separate from the storefront catalog cache
 * so admin reads can never slow down or invalidate customer requests.
 */
export const ADMIN_ORDERS_CACHE_TAG = "admin-orders";
const ADMIN_ORDERS_CACHE_SECONDS = 15;

const defaultRepository = new SupabaseOrderRepository();

const loadCachedOrders = unstable_cache(
  async () => defaultRepository.listOrders(),
  ["admin-orders-snapshot-v1"],
  { revalidate: ADMIN_ORDERS_CACHE_SECONDS, tags: [ADMIN_ORDERS_CACHE_TAG] }
);

export function invalidateAdminOrdersCache() {
  revalidateTag(ADMIN_ORDERS_CACHE_TAG, { expire: 0 });
}

/** One Supabase snapshot shared by every admin order screen. */
export async function getAdminOrders(
  repository?: AdminOrderRepository
): Promise<AdminOrderDetail[]> {
  const orders = repository
    ? await repository.listOrders()
    : await loadCachedOrders();

  return sortAdminOrders(
    orders,
    "newest"
  ) as AdminOrderDetail[];
}

export async function getAdminOrderSummaries(
  repository?: AdminOrderRepository
): Promise<AdminOrderSummary[]> {
  return (await getAdminOrders(repository)).map(toOrderSummary);
}

export async function getAdminOrderDetail(
  orderId: string,
  repository?: AdminOrderRepository
): Promise<AdminOrderDetail | null> {
  const orders = await getAdminOrders(repository);

  return orders.find((order) => order.orderId === orderId) ?? null;
}

export async function getAdminOrderSlipFileId(
  orderId: string,
  repository: AdminOrderRepository = defaultRepository
) {
  if (!isValidOrderId(orderId)) {
    return null;
  }

  return repository.getSlipFileId(orderId);
}

/* ── Permanent deletion ─────────────────────────────────────────── */

export type SlipCleanupStatus = "deleted" | "skipped" | "failed";

export type DeleteAdminOrderResult = {
  orderId: string;
  deletedItemCount: number;
  slipCleanup: SlipCleanupStatus;
};

export type DeleteOrderDependencies = {
  repository: AdminOrderRepository;
  /** Best-effort slip removal. Never allowed to fail the deletion. */
  deleteSlip: (fileId: string) => Promise<void>;
};

/**
 * Permanently deletes an order. Distinct from ORDER_STATUS = 'cancelled',
 * which keeps the row and its tracking history.
 *
 * Ordering is deliberate and must not be reversed:
 *   1. delete the order in Supabase — order_items cascade in the same
 *      statement, so there can be no orphans and no partial delete
 *   2. only then, best-effort payment slip cleanup
 *
 * Deleting the slip first would risk destroying payment evidence for an
 * order that still exists if the database write then failed.
 */
export async function deleteAdminOrder(
  orderId: string,
  dependencies: Partial<DeleteOrderDependencies> = {}
): Promise<DeleteAdminOrderResult> {
  const repository = dependencies.repository ?? defaultRepository;

  if (!isValidOrderId(orderId)) {
    throw new OrderAdminError("Order was not found.", 404);
  }

  // 1. Database is authoritative. A throw here propagates and the slip is
  //    left completely untouched.
  const deleted = await repository.deleteOrder(orderId);

  if (!deleted) {
    throw new OrderAdminError("Order was not found.", 404);
  }

  // 2. Committed. Storage cleanup is advisory from here on and can never
  //    resurrect the order or fail the request.
  const slipCleanup = await cleanUpSlip(
    deleted.slipFileId,
    dependencies.deleteSlip
  );

  invalidateAdminOrdersCacheSafely();

  console.info("Admin order deleted", {
    operation: "delete-order",
    orderId: deleted.orderId,
    deletedItemCount: deleted.deletedItemCount,
    slipCleanup
  });

  return {
    orderId: deleted.orderId,
    deletedItemCount: deleted.deletedItemCount,
    slipCleanup
  };
}

async function cleanUpSlip(
  slipFileId: string | null,
  deleteSlip?: (fileId: string) => Promise<void>
): Promise<SlipCleanupStatus> {
  const fileId = slipFileId?.trim() ?? "";

  // No slip, blank reference, or an unusable one: nothing to clean up.
  if (!fileId) {
    return "skipped";
  }

  try {
    const remove =
      deleteSlip ??
      (async (id: string) => {
        const { PaymentSlipStorageRouter } = await import(
          "./payment-slip-storage"
        );
        await new PaymentSlipStorageRouter().delete(id);
      });

    await remove(fileId);
    return "deleted";
  } catch (error) {
    // Safe metadata only: never the storage reference or credentials.
    console.warn("Order slip cleanup failed", {
      operation: "delete-order",
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    return "failed";
  }
}

export type AdminDashboardData = {
  metrics: AdminDashboardMetrics;
  recentOrders: AdminOrderSummary[];
};

export async function getAdminDashboard(
  repository?: AdminOrderRepository,
  now: Date = new Date()
): Promise<AdminDashboardData> {
  const orders = await getAdminOrders(repository);
  const summaries = orders.map(toOrderSummary);

  return {
    metrics: calculateDashboardMetrics(summaries, now),
    recentOrders: summaries.slice(0, 8)
  };
}

/* ── Mutation ───────────────────────────────────────────────────── */

export const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export function isValidOrderId(value: unknown) {
  return ORDER_ID_PATTERN.test(typeof value === "string" ? value.trim() : "");
}

/**
 * Builds a patch containing only the four allowlisted fields. Any other key
 * in the payload is ignored outright — the client can never name a column.
 */
export function parseAdminOrderPatch(raw: unknown): AdminOrderPatch {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrderAdminError("Order update could not be read.", 400);
  }

  const input = raw as Record<string, unknown>;
  const patch: AdminOrderPatch = {};

  if (input.paymentStatus !== undefined) {
    const value = asTrimmed(input.paymentStatus);

    if (!paymentStatuses.includes(value as PaymentStatus)) {
      throw new OrderAdminError("Select a supported payment status.", 400);
    }

    patch.paymentStatus = value as PaymentStatus;
  }

  if (input.orderStatus !== undefined) {
    const value = asTrimmed(input.orderStatus);

    if (!orderStatuses.includes(value as AdminOrderStatus)) {
      throw new OrderAdminError("Select a supported order status.", 400);
    }

    patch.orderStatus = value as AdminOrderStatus;
  }

  if (input.shippingProvider !== undefined) {
    const value = asTrimmed(input.shippingProvider);

    if (value.length > MAX_SHIPPING_PROVIDER_LENGTH) {
      throw new OrderAdminError(
        `Shipping provider must be ${MAX_SHIPPING_PROVIDER_LENGTH} characters or fewer.`,
        400
      );
    }

    patch.shippingProvider = value;
  }

  if (input.trackingNumber !== undefined) {
    const value = asTrimmed(input.trackingNumber);

    if (value.length > MAX_TRACKING_NUMBER_LENGTH) {
      throw new OrderAdminError(
        `Tracking number must be ${MAX_TRACKING_NUMBER_LENGTH} characters or fewer.`,
        400
      );
    }

    patch.trackingNumber = value;
  }

  if (Object.keys(patch).length === 0) {
    throw new OrderAdminError("No supported order changes were provided.", 400);
  }

  return patch;
}

export async function updateAdminOrder(
  orderId: string,
  raw: unknown,
  repository: AdminOrderRepository = defaultRepository
): Promise<AdminOrderDetail> {
  if (!isValidOrderId(orderId)) {
    throw new OrderAdminError("Order was not found.", 404);
  }

  const patch = parseAdminOrderPatch(raw);
  const orders = await repository.listOrders();
  const matches = orders.filter((order) => order.orderId === orderId);

  if (matches.length === 0) {
    throw new OrderAdminError("Order was not found.", 404);
  }

  if (matches.length > 1) {
    throw new OrderAdminError(
      "This order ID appears more than once, so it was not updated.",
      409
    );
  }

  await repository.updateOrder(orderId, patch);

  // Admin sees its own change immediately rather than up to 15s later.
  invalidateAdminOrdersCacheSafely();

  return { ...matches[0], ...patch };
}

function invalidateAdminOrdersCacheSafely() {
  try {
    invalidateAdminOrdersCache();
  } catch (error) {
    console.warn("Admin orders cache invalidation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
  }
}

function asTrimmed(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
