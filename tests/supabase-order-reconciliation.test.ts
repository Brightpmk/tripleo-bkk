import { describe, expect, it, vi } from "vitest";
import type {
  MigrationIssue,
  NormalizedMigrationData,
  SupabaseOrderInsert,
  SupabaseOrderItemInsert
} from "@/lib/supabase/migration-data";
import {
  isValidReconciliationOrderId,
  reconcileOrder,
  selectOrderForReconciliation,
  type ReconciliationPlan,
  type ReconciliationTarget
} from "@/lib/supabase/order-reconciliation";

const MISSING_ORDER_ID = "KG-2026-668A353F";
const MISSING_ITEM_ID = "KG-2026-668A353F-01";
/** Stands in for the five orders already live in Supabase. */
const EXISTING_ORDER_ID = "KG-2026-EXISTING1";

function sourceOrder(
  overrides: Partial<SupabaseOrderInsert> = {}
): SupabaseOrderInsert {
  return {
    order_id: MISSING_ORDER_ID,
    created_at: "2026-08-30T04:00:00.000Z",
    full_name: "Ada Lovelace",
    phone: "0812345678",
    university: "BANGMOD",
    delivery_method: "shipping",
    shipping_address: "123 Test Road",
    shipping_fee_thb: 50,
    subtotal_thb: 780,
    total_thb: 830,
    payment_status: "verified",
    slip_file_id: "drive-file-1",
    order_status: "shipped",
    shipping_provider: "Kerry",
    tracking_number: "TH1234567890",
    notes: "",
    ...overrides
  };
}

function sourceItem(
  overrides: Partial<SupabaseOrderItemInsert> = {}
): SupabaseOrderItemInsert {
  return {
    order_id: MISSING_ORDER_ID,
    item_id: MISSING_ITEM_ID,
    product_id: "kg-bm-matcha",
    shirt_color: "Matcha",
    size: "M",
    quantity: 2,
    unit_price_thb: 390,
    line_total_thb: 780,
    ...overrides
  };
}

function migrationData(
  overrides: {
    orders?: SupabaseOrderInsert[];
    orderItems?: SupabaseOrderItemInsert[];
    issues?: MigrationIssue[];
  } = {}
): NormalizedMigrationData {
  const issues = overrides.issues ?? [];

  return {
    products: [],
    orders: overrides.orders ?? [
      sourceOrder({ order_id: EXISTING_ORDER_ID }),
      sourceOrder()
    ],
    orderItems: overrides.orderItems ?? [
      sourceItem({
        order_id: EXISTING_ORDER_ID,
        item_id: `${EXISTING_ORDER_ID}-01`
      }),
      sourceItem()
    ],
    report: {
      sourceFields: { products: [], orders: [], orderItems: [] },
      counts: { products: 0, orders: 2, orderItems: 2 },
      skippedBlankRows: { products: 0, orders: 0, orderItems: 0 },
      issues
    } as NormalizedMigrationData["report"]
  };
}

function target(
  overrides: Partial<ReconciliationTarget> = {}
): ReconciliationTarget {
  return {
    findExistingOrderIds: vi.fn(async () => []),
    findExistingItemIds: vi.fn(async () => []),
    insertOrderWithItems: vi.fn(async () => undefined),
    ...overrides
  };
}

function run(
  options: {
    orderId?: string;
    dryRun?: boolean;
    data?: NormalizedMigrationData;
    target?: ReconciliationTarget;
  } = {}
) {
  const reconciliationTarget = options.target ?? target();

  return {
    target: reconciliationTarget,
    promise: reconcileOrder({
      orderId: options.orderId ?? MISSING_ORDER_ID,
      dryRun: options.dryRun ?? false,
      source: { loadNormalized: async () => options.data ?? migrationData() },
      target: reconciliationTarget
    })
  };
}

/* ── Argument handling ──────────────────────────────────────────── */

describe("reconciliation order id", () => {
  it("accepts the real missing order id", () => {
    expect(isValidReconciliationOrderId(MISSING_ORDER_ID)).toBe(true);
  });

  it.each(["", "  ", "ab", "x".repeat(65), "bad id!", null, undefined])(
    "rejects %p",
    (value) => {
      expect(isValidReconciliationOrderId(value)).toBe(false);
    }
  );

  it("aborts without reading the source when the id is invalid", async () => {
    const loadNormalized = vi.fn();
    const result = await reconcileOrder({
      orderId: "",
      dryRun: false,
      source: { loadNormalized },
      target: target()
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe("invalid-order-id");
    expect(loadNormalized).not.toHaveBeenCalled();
  });
});

/* ── Source selection ───────────────────────────────────────────── */

describe("source selection", () => {
  it("selects only the requested order and its own items", () => {
    const selected = selectOrderForReconciliation(
      migrationData(),
      MISSING_ORDER_ID
    ) as ReconciliationPlan;

    expect(selected.order.order_id).toBe(MISSING_ORDER_ID);
    expect(selected.items).toHaveLength(1);
    expect(selected.items[0].item_id).toBe(MISSING_ITEM_ID);
  });

  it("reports a missing source order", async () => {
    const { promise } = run({ orderId: "KG-2026-NOTHERE1" });
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe("source-order-missing");
  });

  it("reports an order with no items rather than importing an empty order", async () => {
    const { promise, target: reconciliationTarget } = run({
      data: migrationData({ orderItems: [] })
    });
    const result = await promise;

    expect(result.ok ? null : result.reason).toBe("source-items-missing");
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });

  it("refuses a duplicated source order id", async () => {
    const { promise } = run({
      data: migrationData({ orders: [sourceOrder(), sourceOrder()] })
    });
    const result = await promise;

    expect(result.ok ? null : result.reason).toBe("source-validation-failed");
  });

  it("blocks on a validation error for this order", async () => {
    const { promise, target: reconciliationTarget } = run({
      data: migrationData({
        issues: [
          {
            sheet: "Orders",
            rowNumber: 7,
            severity: "error",
            code: "invalid_total",
            message: `Order ${MISSING_ORDER_ID} has an invalid TOTAL`
          }
        ]
      })
    });
    const result = await promise;

    expect(result.ok ? null : result.reason).toBe("source-validation-failed");
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });

  it("ignores validation errors that belong to unrelated rows", async () => {
    const { promise } = run({
      data: migrationData({
        issues: [
          {
            sheet: "Orders",
            rowNumber: 3,
            severity: "error",
            code: "invalid_total",
            message: `Order ${EXISTING_ORDER_ID} has an invalid TOTAL`
          }
        ]
      })
    });

    expect((await promise).ok).toBe(true);
  });
});

/* ── Insert-only guarantees ─────────────────────────────────────── */

describe("insert-only guarantees", () => {
  it("aborts when the target ORDER_ID already exists", async () => {
    const reconciliationTarget = target({
      findExistingOrderIds: vi.fn(async () => [MISSING_ORDER_ID])
    });
    const result = await run({ target: reconciliationTarget }).promise;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe("target-order-exists");
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });

  it("aborts when any target ITEM_ID already exists", async () => {
    const reconciliationTarget = target({
      findExistingItemIds: vi.fn(async () => [MISSING_ITEM_ID])
    });
    const result = await run({ target: reconciliationTarget }).promise;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe("target-items-exist");
    expect(result.ok ? [] : result.details).toContain(MISSING_ITEM_ID);
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });

  it("checks conflicts before writing, even in write mode", async () => {
    const calls: string[] = [];
    const reconciliationTarget: ReconciliationTarget = {
      findExistingOrderIds: async () => {
        calls.push("check-order");
        return [];
      },
      findExistingItemIds: async () => {
        calls.push("check-items");
        return [];
      },
      insertOrderWithItems: async () => {
        calls.push("insert");
      }
    };

    await run({ target: reconciliationTarget }).promise;

    expect(calls).toEqual(["check-order", "check-items", "insert"]);
  });

  it("never issues an update or upsert — only the insert path exists", async () => {
    const reconciliationTarget = target();
    await run({ target: reconciliationTarget }).promise;

    expect(Object.keys(reconciliationTarget)).toEqual([
      "findExistingOrderIds",
      "findExistingItemIds",
      "insertOrderWithItems"
    ]);
  });
});

/* ── Dry run ────────────────────────────────────────────────────── */

describe("dry run", () => {
  it("validates and checks conflicts but writes nothing", async () => {
    const reconciliationTarget = target();
    const result = await run({ dryRun: true, target: reconciliationTarget })
      .promise;

    expect(result.ok).toBe(true);
    expect(result.ok && result.dryRun).toBe(true);
    expect(reconciliationTarget.findExistingOrderIds).toHaveBeenCalledWith(
      MISSING_ORDER_ID
    );
    expect(reconciliationTarget.findExistingItemIds).toHaveBeenCalledWith([
      MISSING_ITEM_ID
    ]);
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });

  it("reports the order id and item count", async () => {
    const result = await run({ dryRun: true }).promise;

    expect(result.ok && result.orderId).toBe(MISSING_ORDER_ID);
    expect(result.ok && result.itemCount).toBe(1);
    expect(result.ok && result.itemIds).toEqual([MISSING_ITEM_ID]);
  });

  it("keeps customer-sensitive values out of the printable summary", async () => {
    const result = await run({ dryRun: true }).promise;
    const printable = JSON.stringify(result.ok ? result.summary : {});

    expect(printable).not.toContain("Ada Lovelace");
    expect(printable).not.toContain("0812345678");
    expect(printable).not.toContain("123 Test Road");
    expect(printable).not.toContain("drive-file-1");
    // Presence is reported without revealing the values.
    expect(result.ok && result.summary.hasSlipReference).toBe(true);
    expect(result.ok && result.summary.hasShippingAddress).toBe(true);
  });

  it("still aborts on a conflict without writing", async () => {
    const reconciliationTarget = target({
      findExistingOrderIds: vi.fn(async () => [MISSING_ORDER_ID])
    });
    const result = await run({ dryRun: true, target: reconciliationTarget })
      .promise;

    expect(result.ok ? null : result.reason).toBe("target-order-exists");
    expect(reconciliationTarget.insertOrderWithItems).not.toHaveBeenCalled();
  });
});

/* ── Successful reconciliation ──────────────────────────────────── */

describe("successful reconciliation", () => {
  it("inserts one order with one item, preserving historical values", async () => {
    let plan: ReconciliationPlan | null = null;
    const reconciliationTarget = target({
      insertOrderWithItems: vi.fn(async (received: ReconciliationPlan) => {
        plan = received;
      })
    });

    const result = await run({ target: reconciliationTarget }).promise;

    expect(result.ok).toBe(true);
    expect(result.ok && result.dryRun).toBe(false);
    expect(reconciliationTarget.insertOrderWithItems).toHaveBeenCalledTimes(1);

    const written = plan as ReconciliationPlan | null;
    expect(written?.order).toMatchObject({
      order_id: MISSING_ORDER_ID,
      created_at: "2026-08-30T04:00:00.000Z",
      university: "BANGMOD",
      delivery_method: "shipping",
      subtotal_thb: 780,
      shipping_fee_thb: 50,
      total_thb: 830,
      payment_status: "verified",
      order_status: "shipped",
      shipping_provider: "Kerry",
      tracking_number: "TH1234567890",
      slip_file_id: "drive-file-1"
    });
    expect(written?.items[0]).toMatchObject({
      item_id: MISSING_ITEM_ID,
      shirt_color: "Matcha",
      size: "M",
      quantity: 2,
      unit_price_thb: 390,
      line_total_thb: 780
    });
  });

  it("supports an order with multiple items", async () => {
    let plan: ReconciliationPlan | null = null;
    const reconciliationTarget = target({
      insertOrderWithItems: vi.fn(async (received: ReconciliationPlan) => {
        plan = received;
      })
    });

    const result = await run({
      target: reconciliationTarget,
      data: migrationData({
        orders: [sourceOrder()],
        orderItems: [
          sourceItem(),
          sourceItem({
            item_id: `${MISSING_ORDER_ID}-02`,
            shirt_color: "Charcoal",
            size: "4XL",
            quantity: 3,
            unit_price_thb: 265,
            line_total_thb: 795
          })
        ]
      })
    }).promise;

    expect(result.ok && result.itemCount).toBe(2);
    expect(result.ok && result.summary.totalQuantity).toBe(5);
    expect((plan as ReconciliationPlan | null)?.items).toHaveLength(2);
  });

  it("passes only this order's items to the target", async () => {
    let plan: ReconciliationPlan | null = null;
    const reconciliationTarget = target({
      insertOrderWithItems: vi.fn(async (received: ReconciliationPlan) => {
        plan = received;
      })
    });

    await run({ target: reconciliationTarget }).promise;

    const written = plan as ReconciliationPlan | null;
    expect(
      written?.items.every((item) => item.order_id === MISSING_ORDER_ID)
    ).toBe(true);
    // The other archived order is never handed to Supabase.
    expect(JSON.stringify(written)).not.toContain(EXISTING_ORDER_ID);
  });
});

/* ── Atomicity ──────────────────────────────────────────────────── */

describe("atomic failure behaviour", () => {
  it("surfaces a transactional failure instead of reporting success", async () => {
    const reconciliationTarget = target({
      insertOrderWithItems: vi.fn(async () => {
        // What the RPC raises on a duplicate key; plpgsql rolls the whole
        // function back, so neither the order nor any item is left behind.
        throw new Error("duplicate key value violates unique constraint");
      })
    });

    await expect(run({ target: reconciliationTarget }).promise).rejects.toThrow(
      "duplicate key value violates unique constraint"
    );
  });

  it("makes exactly one insert call, so items cannot land without the order", async () => {
    const reconciliationTarget = target();
    await run({ target: reconciliationTarget }).promise;

    expect(reconciliationTarget.insertOrderWithItems).toHaveBeenCalledTimes(1);
  });
});

/* ── Scope ──────────────────────────────────────────────────────── */

describe("blast radius", () => {
  it("only ever queries Supabase for the requested identifiers", async () => {
    const reconciliationTarget = target();
    await run({ target: reconciliationTarget }).promise;

    expect(reconciliationTarget.findExistingOrderIds).toHaveBeenCalledTimes(1);
    expect(reconciliationTarget.findExistingOrderIds).toHaveBeenCalledWith(
      MISSING_ORDER_ID
    );
    expect(reconciliationTarget.findExistingItemIds).toHaveBeenCalledTimes(1);
    expect(reconciliationTarget.findExistingItemIds).toHaveBeenCalledWith([
      MISSING_ITEM_ID
    ]);
  });

  it("never touches products", async () => {
    let plan: ReconciliationPlan | null = null;
    const reconciliationTarget = target({
      insertOrderWithItems: vi.fn(async (received: ReconciliationPlan) => {
        plan = received;
      })
    });

    await run({ target: reconciliationTarget }).promise;

    expect(plan as ReconciliationPlan | null).not.toHaveProperty("products");
  });
});
