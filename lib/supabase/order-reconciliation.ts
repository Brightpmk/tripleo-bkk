import {
  hasBlockingMigrationIssues,
  type MigrationIssue,
  type NormalizedMigrationData,
  type SupabaseOrderInsert,
  type SupabaseOrderItemInsert
} from "./migration-data";

/**
 * One-off reconciliation of a single archived order into Supabase.
 *
 * Supabase is the source of truth and may hold newer admin edits, so this is
 * strictly INSERT-ONLY: it aborts if the target order or any of its items
 * already exist, and it never touches an unrelated row. It is manual recovery
 * tooling — nothing here is imported by the app runtime.
 */

const orderIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export type ReconciliationPlan = {
  orderId: string;
  order: SupabaseOrderInsert;
  items: SupabaseOrderItemInsert[];
};

export type ReconciliationFailure = {
  ok: false;
  reason:
    | "invalid-order-id"
    | "source-order-missing"
    | "source-items-missing"
    | "source-validation-failed"
    | "target-order-exists"
    | "target-items-exist";
  message: string;
  details: string[];
};

export type ReconciliationSuccess = {
  ok: true;
  dryRun: boolean;
  orderId: string;
  itemIds: string[];
  itemCount: number;
  /** Safe to print: no name, phone, address, or slip reference. */
  summary: {
    createdAt: string;
    university: string;
    deliveryMethod: string;
    paymentStatus: string;
    orderStatus: string;
    subtotalThb: number;
    shippingFeeThb: number;
    totalThb: number;
    totalQuantity: number;
    hasSlipReference: boolean;
    hasShippingAddress: boolean;
  };
};

export type ReconciliationResult = ReconciliationSuccess | ReconciliationFailure;

/** Reads only the archived source; performs no writes. */
export type ReconciliationSource = {
  loadNormalized: () => Promise<NormalizedMigrationData>;
};

export type ReconciliationTarget = {
  /** Existing order_id values matching the candidate (empty when absent). */
  findExistingOrderIds: (orderId: string) => Promise<string[]>;
  /** Existing item_id values from the candidate set (empty when absent). */
  findExistingItemIds: (itemIds: string[]) => Promise<string[]>;
  /** Must insert the order and every item atomically, or nothing at all. */
  insertOrderWithItems: (plan: ReconciliationPlan) => Promise<void>;
};

export function isValidReconciliationOrderId(value: unknown) {
  return orderIdPattern.test(typeof value === "string" ? value.trim() : "");
}

/**
 * Narrows a full normalized migration snapshot down to one order and its
 * items. Unrelated rows are discarded here and never reach the target.
 */
export function selectOrderForReconciliation(
  data: NormalizedMigrationData,
  orderId: string
): ReconciliationPlan | ReconciliationFailure {
  const matchingOrders = data.orders.filter((row) => row.order_id === orderId);

  if (matchingOrders.length === 0) {
    return failure(
      "source-order-missing",
      `Order ${orderId} was not found in the archived sheet.`
    );
  }

  if (matchingOrders.length > 1) {
    return failure(
      "source-validation-failed",
      `Order ${orderId} appears ${matchingOrders.length} times in the archived sheet.`
    );
  }

  const items = data.orderItems.filter((row) => row.order_id === orderId);

  if (items.length === 0) {
    return failure(
      "source-items-missing",
      `Order ${orderId} has no OrderItems rows in the archived sheet.`
    );
  }

  return { orderId, order: matchingOrders[0], items };
}

/**
 * Only issues belonging to this order block the import. A validation problem
 * on an unrelated archived row must not stop the one row we are recovering.
 */
export function findBlockingIssuesForOrder(
  data: NormalizedMigrationData,
  plan: ReconciliationPlan
): MigrationIssue[] {
  if (!hasBlockingMigrationIssues(data.report)) {
    return [];
  }

  const itemIds = new Set(plan.items.map((item) => item.item_id));

  return data.report.issues.filter((issue) => {
    if (issue.severity !== "error") {
      return false;
    }

    if (issue.sheet === "Products") {
      return false;
    }

    return (
      issue.message.includes(plan.orderId) ||
      [...itemIds].some((itemId) => issue.message.includes(itemId))
    );
  });
}

export type ReconcileOptions = {
  orderId: string;
  dryRun: boolean;
  source: ReconciliationSource;
  target: ReconciliationTarget;
};

export async function reconcileOrder({
  orderId,
  dryRun,
  source,
  target
}: ReconcileOptions): Promise<ReconciliationResult> {
  const trimmedOrderId = typeof orderId === "string" ? orderId.trim() : "";

  if (!isValidReconciliationOrderId(trimmedOrderId)) {
    return failure(
      "invalid-order-id",
      "Provide a single valid ORDER_ID, for example KG-2026-668A353F."
    );
  }

  const data = await source.loadNormalized();
  const selected = selectOrderForReconciliation(data, trimmedOrderId);

  if ("ok" in selected) {
    return selected;
  }

  const blocking = findBlockingIssuesForOrder(data, selected);

  if (blocking.length > 0) {
    return failure(
      "source-validation-failed",
      `Order ${trimmedOrderId} failed source validation.`,
      blocking.map(
        (issue) => `${issue.sheet} row ${issue.rowNumber} [${issue.code}]: ${issue.message}`
      )
    );
  }

  // Conflict checks run before any write, in both dry-run and real mode.
  const existingOrderIds = await target.findExistingOrderIds(selected.orderId);

  if (existingOrderIds.length > 0) {
    return failure(
      "target-order-exists",
      `Order ${selected.orderId} already exists in Supabase. This tool never overwrites an existing row.`
    );
  }

  const candidateItemIds = selected.items.map((item) => item.item_id);
  const existingItemIds = await target.findExistingItemIds(candidateItemIds);

  if (existingItemIds.length > 0) {
    return failure(
      "target-items-exist",
      `Order items already exist in Supabase. This tool never overwrites an existing row.`,
      existingItemIds
    );
  }

  if (!dryRun) {
    await target.insertOrderWithItems(selected);
  }

  return {
    ok: true,
    dryRun,
    orderId: selected.orderId,
    itemIds: candidateItemIds,
    itemCount: selected.items.length,
    summary: {
      createdAt: selected.order.created_at,
      university: selected.order.university,
      deliveryMethod: selected.order.delivery_method,
      paymentStatus: selected.order.payment_status,
      orderStatus: selected.order.order_status,
      subtotalThb: selected.order.subtotal_thb,
      shippingFeeThb: selected.order.shipping_fee_thb,
      totalThb: selected.order.total_thb,
      totalQuantity: selected.items.reduce((sum, item) => sum + item.quantity, 0),
      // Presence only — the values themselves are never surfaced.
      hasSlipReference: Boolean(selected.order.slip_file_id),
      hasShippingAddress: Boolean(selected.order.shipping_address)
    }
  };
}

function failure(
  reason: ReconciliationFailure["reason"],
  message: string,
  details: string[] = []
): ReconciliationFailure {
  return { ok: false, reason, message, details };
}
