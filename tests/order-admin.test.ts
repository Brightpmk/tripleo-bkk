import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bangkokDayKey,
  calculateDashboardMetrics,
  filterAdminOrders,
  defaultAdminOrderFilters,
  matchesOrderSearch,
  parseOrderStatus,
  parsePaymentStatus,
  sortAdminOrders,
  type AdminOrderDetail,
  type AdminOrderSummary
} from "@/lib/orders-admin";
import {
  joinOrderSheets,
  toOrderSummary,
  type AdminOrderRepository
} from "@/lib/server/order-repository";
import {
  getAdminDashboard,
  parseAdminOrderPatch,
  updateAdminOrder
} from "@/lib/server/order-admin-service";
import { updateOrderRowValuesWithClient } from "@/lib/server/google-sheets";
import { PATCH as patchOrder } from "@/app/api/admin/orders/[orderId]/route";
import { GET as getSlip } from "@/app/api/admin/orders/[orderId]/slip/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

const orderHeaders = [
  "ORDER_ID",
  "CREATED_AT",
  "UNIVERSITY",
  "FULL_NAME",
  "PHONE",
  "DELIVERY_METHOD",
  "SHIPPING_ADDRESS",
  "SHIPPING_FEE",
  "SUBTOTAL",
  "TOTAL",
  "PAYMENT_STATUS",
  "SLIP_FILE_ID",
  "SLIP_URL",
  "ORDER_STATUS",
  "SHIPPING_PROVIDER",
  "TRACKING_NUMBER",
  "NOTES"
];

const itemHeaders = [
  "ORDER_ID",
  "ITEM_ID",
  "PRODUCT_ID",
  "SHIRT_COLOR",
  "SIZE",
  "QUANTITY",
  "UNIT_PRICE",
  "LINE_TOTAL"
];

function orderRow(overrides: Partial<Record<string, string | number>> = {}) {
  const base: Record<string, string | number> = {
    ORDER_ID: "KG-2026-AAAA1111",
    CREATED_AT: "2026-08-30T04:00:00.000Z",
    UNIVERSITY: "BANGMOD",
    FULL_NAME: "Ada Lovelace",
    PHONE: "0812345678",
    DELIVERY_METHOD: "SHIPPING",
    SHIPPING_ADDRESS: "123 Test Road",
    SHIPPING_FEE: 50,
    SUBTOTAL: 780,
    TOTAL: 830,
    PAYMENT_STATUS: "PENDING",
    SLIP_FILE_ID: "drive-1",
    SLIP_URL: "",
    ORDER_STATUS: "NEW",
    SHIPPING_PROVIDER: "",
    TRACKING_NUMBER: "",
    NOTES: "",
    ...overrides
  };

  return orderHeaders.map((header) => base[header] ?? "");
}

function itemRow(values: Partial<Record<string, string | number>>) {
  const base: Record<string, string | number> = {
    ORDER_ID: "KG-2026-AAAA1111",
    ITEM_ID: "KG-2026-AAAA1111-01",
    PRODUCT_ID: "kg-bm-matcha",
    SHIRT_COLOR: "Matcha",
    SIZE: "M",
    QUANTITY: 2,
    UNIT_PRICE: 390,
    LINE_TOTAL: 780,
    ...values
  };

  return itemHeaders.map((header) => base[header] ?? "");
}

function summary(overrides: Partial<AdminOrderSummary> = {}): AdminOrderSummary {
  return {
    orderId: "KG-2026-AAAA1111",
    createdAtIso: "2026-08-30T04:00:00.000Z",
    universityId: "bangmod",
    universityLabel: "bm.swagclub",
    customerName: "Ada Lovelace",
    phone: "0812345678",
    deliveryMethod: "shipping",
    itemCount: 2,
    subtotalThb: 780,
    shippingFeeThb: 50,
    totalThb: 830,
    paymentStatus: "pending",
    orderStatus: "new",
    shippingProvider: "",
    trackingNumber: "",
    hasSlip: true,
    dataIssues: [],
    ...overrides
  };
}

/* ── Join ───────────────────────────────────────────────────────── */

describe("Orders + OrderItems join", () => {
  it("joins one order to one item", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow()],
      [itemHeaders, itemRow({})]
    );

    expect(orders).toHaveLength(1);
    expect(orders[0].items).toHaveLength(1);
    expect(orders[0].itemCount).toBe(2);
    expect(orders[0].items[0].lineTotalThb).toBe(780);
  });

  it("joins one order to multiple items and sums quantities", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow()],
      [
        itemHeaders,
        itemRow({}),
        itemRow({
          ITEM_ID: "KG-2026-AAAA1111-02",
          SHIRT_COLOR: "Charcoal",
          SIZE: "4XL",
          QUANTITY: 3,
          UNIT_PRICE: 265,
          LINE_TOTAL: 795
        })
      ]
    );

    expect(orders[0].items).toHaveLength(2);
    expect(orders[0].itemCount).toBe(5);
  });

  it("uses the stored UNIT_PRICE, surcharge included, never current pricing", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow()],
      [
        itemHeaders,
        itemRow({ SIZE: "4XL", QUANTITY: 2, UNIT_PRICE: 265, LINE_TOTAL: 530 })
      ]
    );

    expect(orders[0].items[0].unitPriceThb).toBe(265);
    expect(orders[0].items[0].lineTotalThb).toBe(530);
  });

  it("derives a missing LINE_TOTAL from unit price x quantity", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow()],
      [itemHeaders, itemRow({ QUANTITY: 3, UNIT_PRICE: 100, LINE_TOTAL: "" })]
    );

    expect(orders[0].items[0].lineTotalThb).toBe(300);
  });

  it("ignores orphan OrderItems and flags the order with no items", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow()],
      [
        itemHeaders,
        itemRow({ ORDER_ID: "KG-2026-ORPHAN99" }),
        itemRow({ ORDER_ID: "" })
      ]
    );

    expect(orders).toHaveLength(1);
    expect(orders[0].items).toHaveLength(0);
    expect(orders[0].dataIssues).toContain("No order items found");
  });

  it("degrades a malformed row instead of failing the whole dashboard", () => {
    const orders = joinOrderSheets(
      [
        orderHeaders,
        orderRow({ PAYMENT_STATUS: "???", ORDER_STATUS: "???", DELIVERY_METHOD: "???" }),
        orderRow({ ORDER_ID: "KG-2026-BBBB2222" })
      ],
      [itemHeaders, itemRow({}), itemRow({ ORDER_ID: "KG-2026-BBBB2222" })]
    );

    expect(orders).toHaveLength(2);
    expect(orders[0].dataIssues).toEqual(
      expect.arrayContaining([
        "Unrecognised payment status",
        "Unrecognised order status",
        "Unrecognised delivery method"
      ])
    );
  });

  it("throws when Orders headers are malformed", () => {
    expect(() => joinOrderSheets([["NOPE"], ["x"]], [])).toThrow();
  });

  it("keeps phone values as strings with leading zeros", () => {
    const orders = joinOrderSheets(
      [orderHeaders, orderRow({ PHONE: "0812345678" })],
      [itemHeaders, itemRow({})]
    );

    expect(orders[0].phone).toBe("0812345678");
  });

  it("parses numbers formatted with currency symbols (฿, $, THB) and commas", () => {
    const orders = joinOrderSheets(
      [
        orderHeaders,
        orderRow({
          SHIPPING_FEE: "฿50",
          SUBTOTAL: "฿9,075",
          TOTAL: "฿9,125"
        })
      ],
      [
        itemHeaders,
        itemRow({
          QUANTITY: "2",
          UNIT_PRICE: "฿4,537.50",
          LINE_TOTAL: "฿9,075"
        })
      ]
    );

    expect(orders[0].shippingFeeThb).toBe(50);
    expect(orders[0].subtotalThb).toBe(9075);
    expect(orders[0].totalThb).toBe(9125);
    expect(orders[0].items[0].quantity).toBe(2);
    expect(orders[0].items[0].unitPriceThb).toBe(4537.5);
    expect(orders[0].items[0].lineTotalThb).toBe(9075);
  });

  it("strips address, notes, and items from the list summary DTO", () => {
    const [order] = joinOrderSheets(
      [orderHeaders, orderRow()],
      [itemHeaders, itemRow({})]
    );
    const listed = toOrderSummary(order) as Record<string, unknown>;

    expect(listed).not.toHaveProperty("shippingAddress");
    expect(listed).not.toHaveProperty("notes");
    expect(listed).not.toHaveProperty("items");
    expect(JSON.stringify(listed)).not.toContain("123 Test Road");
  });

  it("never exposes the slip file id in any order DTO", () => {
    const [order] = joinOrderSheets(
      [orderHeaders, orderRow()],
      [itemHeaders, itemRow({})]
    );

    expect(JSON.stringify(order)).not.toContain("drive-1");
    expect(order.hasSlip).toBe(true);
  });
});

/* ── Status parsing ─────────────────────────────────────────────── */

describe("status normalisation", () => {
  it.each([
    ["PENDING", "pending"],
    ["VERIFIED", "verified"],
    ["PAID", "verified"],
    ["REVIEW_REQUIRED", "review_required"],
    ["REJECTED", "rejected"]
  ])("parses payment status %s", (raw, expected) => {
    expect(parsePaymentStatus(raw)).toBe(expected);
  });

  it.each([
    ["NEW", "new"],
    ["PENDING", "new"],
    ["PREPARING", "preparing"],
    ["SHIPPED", "shipped"],
    ["COMPLETED", "completed"],
    ["CANCELLED", "cancelled"],
    ["CANCELED", "cancelled"]
  ])("parses order status %s", (raw, expected) => {
    expect(parseOrderStatus(raw)).toBe(expected);
  });

  it("rejects unknown statuses rather than guessing", () => {
    expect(parsePaymentStatus("SOMETHING")).toBeNull();
    expect(parseOrderStatus("SOMETHING")).toBeNull();
  });
});

/* ── Search, filters, sorting ───────────────────────────────────── */

describe("orders list behaviour", () => {
  const orders = [
    summary({ orderId: "KG-2026-AAAA1111", customerName: "Ada Lovelace", phone: "0812345678", totalThb: 830, createdAtIso: "2026-08-30T04:00:00.000Z" }),
    summary({ orderId: "KG-2026-BBBB2222", customerName: "Grace Hopper", phone: "0899999999", totalThb: 1200, createdAtIso: "2026-08-28T04:00:00.000Z", paymentStatus: "verified", orderStatus: "shipped", deliveryMethod: "pickup", universityId: "maejo" }),
    summary({ orderId: "KG-2026-CCCC3333", customerName: "Alan Turing", phone: "0800000001", totalThb: 400, createdAtIso: "2026-08-29T04:00:00.000Z", orderStatus: "cancelled" })
  ];

  it("searches by order ID", () => {
    expect(matchesOrderSearch(orders[0], "BBBB")).toBe(false);
    expect(matchesOrderSearch(orders[1], "bbbb")).toBe(true);
  });

  it("searches by customer name, case insensitively", () => {
    expect(matchesOrderSearch(orders[0], "ada")).toBe(true);
    expect(matchesOrderSearch(orders[0], "grace")).toBe(false);
  });

  it("searches by phone, ignoring separators and keeping leading zeros", () => {
    expect(matchesOrderSearch(orders[0], "081-234 5678")).toBe(true);
    expect(matchesOrderSearch(orders[0], "0812")).toBe(true);
    expect(matchesOrderSearch(orders[1], "0812")).toBe(false);
  });

  it("does not match on one or two stray digits", () => {
    expect(matchesOrderSearch(orders[0], "8")).toBe(false);
  });

  it("filters by payment, order status, delivery, and university", () => {
    expect(
      filterAdminOrders(orders, { ...defaultAdminOrderFilters, paymentStatus: "verified" })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, { ...defaultAdminOrderFilters, orderStatus: "cancelled" })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, { ...defaultAdminOrderFilters, deliveryMethod: "pickup" })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, { ...defaultAdminOrderFilters, universityId: "maejo" })
    ).toHaveLength(1);
  });

  it("defaults to newest first and supports the other sorts", () => {
    expect(sortAdminOrders(orders, "newest").map((o) => o.orderId)).toEqual([
      "KG-2026-AAAA1111",
      "KG-2026-CCCC3333",
      "KG-2026-BBBB2222"
    ]);
    expect(sortAdminOrders(orders, "oldest")[0].orderId).toBe("KG-2026-BBBB2222");
    expect(sortAdminOrders(orders, "highest")[0].totalThb).toBe(1200);
    expect(sortAdminOrders(orders, "lowest")[0].totalThb).toBe(400);
  });
});

/* ── Dashboard metrics ──────────────────────────────────────────── */

describe("dashboard metrics", () => {
  it("anchors 'today' to Bangkok midnight, not UTC", () => {
    // 17:30 UTC on the 29th is already 00:30 on the 30th in Bangkok.
    expect(bangkokDayKey("2026-08-29T17:30:00.000Z")).toBe("2026-08-30");
    // 16:30 UTC is still the 29th in Bangkok (23:30).
    expect(bangkokDayKey("2026-08-29T16:30:00.000Z")).toBe("2026-08-29");
  });

  it("counts orders and revenue for the Bangkok day only", () => {
    const now = new Date("2026-08-30T03:00:00.000Z"); // 10:00 Bangkok, 30 Aug
    const metrics = calculateDashboardMetrics(
      [
        summary({ createdAtIso: "2026-08-29T17:30:00.000Z", totalThb: 100 }),
        summary({ createdAtIso: "2026-08-30T02:00:00.000Z", totalThb: 200 }),
        summary({ createdAtIso: "2026-08-29T16:30:00.000Z", totalThb: 999 })
      ],
      now
    );

    expect(metrics.todayKey).toBe("2026-08-30");
    expect(metrics.ordersToday).toBe(2);
    expect(metrics.revenueTodayThb).toBe(300);
    expect(metrics.totalRevenueThb).toBe(1299);
  });

  it("excludes cancelled orders and rejected payments from revenue", () => {
    const metrics = calculateDashboardMetrics(
      [
        summary({ totalThb: 100 }),
        summary({ totalThb: 500, orderStatus: "cancelled" }),
        summary({ totalThb: 700, paymentStatus: "rejected" })
      ],
      new Date("2026-08-30T03:00:00.000Z")
    );

    expect(metrics.totalRevenueThb).toBe(100);
    expect(metrics.cancelledOrders).toBe(1);
  });

  it("counts pending, paid, awaiting fulfilment, and shipped", () => {
    const metrics = calculateDashboardMetrics(
      [
        summary({ paymentStatus: "pending", orderStatus: "new" }),
        summary({ paymentStatus: "verified", orderStatus: "new" }),
        summary({ paymentStatus: "verified", orderStatus: "preparing" }),
        summary({ paymentStatus: "verified", orderStatus: "shipped" })
      ],
      new Date("2026-08-30T03:00:00.000Z")
    );

    expect(metrics.pendingPayments).toBe(1);
    expect(metrics.paidOrders).toBe(3);
    // Paid but not yet out the door.
    expect(metrics.awaitingFulfillment).toBe(2);
    expect(metrics.shippedOrders).toBe(1);
  });

  it("builds the dashboard from a single repository read", async () => {
    const listOrders = vi.fn(async () => [
      { ...summary(), shippingAddress: "123 Test Road", notes: "", items: [] }
    ] as AdminOrderDetail[]);

    const dashboard = await getAdminDashboard(
      { listOrders, updateOrder: vi.fn(), getSlipFileId: vi.fn() },
      new Date("2026-08-30T03:00:00.000Z")
    );

    expect(listOrders).toHaveBeenCalledTimes(1);
    expect(dashboard.metrics.totalOrders).toBe(1);
    expect(JSON.stringify(dashboard.recentOrders)).not.toContain("123 Test Road");
  });
});

/* ── Mutations ──────────────────────────────────────────────────── */

describe("admin order mutations", () => {
  // revalidateTag throws outside a Next request scope; the service catches it
  // and warns. That is the intended behaviour, so just keep it out of output.
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function repo(overrides: Partial<AdminOrderRepository> = {}): AdminOrderRepository {
    return {
      listOrders: vi.fn(async () => [
        { ...summary(), shippingAddress: "123 Test Road", notes: "", items: [] }
      ] as AdminOrderDetail[]),
      updateOrder: vi.fn(async () => undefined),
      getSlipFileId: vi.fn(async () => "drive-1"),
      ...overrides
    };
  }

  it("updates payment status", async () => {
    const repository = repo();
    const result = await updateAdminOrder(
      "KG-2026-AAAA1111",
      { paymentStatus: "verified" },
      repository
    );

    expect(repository.updateOrder).toHaveBeenCalledWith("KG-2026-AAAA1111", {
      paymentStatus: "verified"
    });
    expect(result.paymentStatus).toBe("verified");
  });

  it("updates order status, provider, and tracking together", async () => {
    const repository = repo();

    await updateAdminOrder(
      "KG-2026-AAAA1111",
      {
        orderStatus: "shipped",
        shippingProvider: "  Kerry  ",
        trackingNumber: " TH123456 "
      },
      repository
    );

    expect(repository.updateOrder).toHaveBeenCalledWith("KG-2026-AAAA1111", {
      orderStatus: "shipped",
      shippingProvider: "Kerry",
      trackingNumber: "TH123456"
    });
  });

  it("rejects invalid statuses", () => {
    expect(() => parseAdminOrderPatch({ paymentStatus: "refunded" })).toThrow();
    expect(() => parseAdminOrderPatch({ orderStatus: "teleported" })).toThrow();
  });

  it("rejects oversized provider and tracking values", () => {
    expect(() =>
      parseAdminOrderPatch({ shippingProvider: "x".repeat(61) })
    ).toThrow();
    expect(() =>
      parseAdminOrderPatch({ trackingNumber: "x".repeat(65) })
    ).toThrow();
  });

  it("ignores client-supplied fields outside the allowlist", () => {
    expect(() =>
      parseAdminOrderPatch({ TOTAL: 1, ORDER_ID: "hacked", notes: "x" })
    ).toThrow(/No supported order changes/);
  });

  it("never writes a column the client names", async () => {
    const repository = repo();

    await updateAdminOrder(
      "KG-2026-AAAA1111",
      { orderStatus: "preparing", totalThb: 1, customerName: "Mallory" },
      repository
    );

    expect(repository.updateOrder).toHaveBeenCalledWith("KG-2026-AAAA1111", {
      orderStatus: "preparing"
    });
  });

  it("rejects a nonexistent ORDER_ID", async () => {
    const repository = repo({ listOrders: vi.fn(async () => []) });

    await expect(
      updateAdminOrder("KG-2026-MISSING1", { orderStatus: "shipped" }, repository)
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.updateOrder).not.toHaveBeenCalled();
  });

  it("refuses to update when ORDER_ID is duplicated", async () => {
    const duplicate = {
      ...summary(),
      shippingAddress: "",
      notes: "",
      items: []
    } as AdminOrderDetail;
    const repository = repo({
      listOrders: vi.fn(async () => [duplicate, duplicate])
    });

    await expect(
      updateAdminOrder("KG-2026-AAAA1111", { orderStatus: "shipped" }, repository)
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.updateOrder).not.toHaveBeenCalled();
  });
});

/* ── Sheet write resolution ─────────────────────────────────────── */

describe("Orders row resolution", () => {
  const env = {
    GOOGLE_ORDER_SPREADSHEET_ID: "sheet-1",
    GOOGLE_ORDERS_RANGE: "Orders!A:Q"
  };

  type UpdateRequest = {
    range: string;
    requestBody: { values: unknown[][] };
  };

  function client(rows: unknown[][]) {
    const update = vi.fn(async (_request: UpdateRequest) => ({}));
    const get = vi.fn(async () => ({ data: { values: rows } }));

    return {
      update,
      get,
      sheets: { spreadsheets: { values: { get, update } } } as never
    };
  }

  it("resolves the row by ORDER_ID and preserves every other cell", async () => {
    const { sheets, update } = client([
      orderHeaders,
      orderRow({ ORDER_ID: "KG-1" }),
      orderRow({ ORDER_ID: "KG-2", FULL_NAME: "Grace Hopper" })
    ]);

    await updateOrderRowValuesWithClient(sheets, env, "KG-2", {
      ORDER_STATUS: "SHIPPED"
    });

    const call = update.mock.calls[0][0];
    // Row 3 of the sheet: header + two data rows.
    expect(call.range).toBe("Orders!A3:Q3");
    const written = call.requestBody.values[0];
    expect(written[orderHeaders.indexOf("ORDER_STATUS")]).toBe("SHIPPED");
    expect(written[orderHeaders.indexOf("FULL_NAME")]).toBe("Grace Hopper");
    expect(written[orderHeaders.indexOf("TOTAL")]).toBe(830);
  });

  it("returns 404 for an unknown ORDER_ID and writes nothing", async () => {
    const { sheets, update } = client([orderHeaders, orderRow({ ORDER_ID: "KG-1" })]);

    await expect(
      updateOrderRowValuesWithClient(sheets, env, "KG-9", { ORDER_STATUS: "SHIPPED" })
    ).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to write when ORDER_ID is duplicated in the sheet", async () => {
    const { sheets, update } = client([
      orderHeaders,
      orderRow({ ORDER_ID: "KG-1" }),
      orderRow({ ORDER_ID: "KG-1" })
    ]);

    await expect(
      updateOrderRowValuesWithClient(sheets, env, "KG-1", { ORDER_STATUS: "SHIPPED" })
    ).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it("never targets the header row", async () => {
    const { sheets, update } = client([orderHeaders, orderRow({ ORDER_ID: "KG-1" })]);

    await expect(
      updateOrderRowValuesWithClient(sheets, env, "ORDER_ID", {
        ORDER_STATUS: "SHIPPED"
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an unknown column outright", async () => {
    const { sheets, update } = client([orderHeaders, orderRow({ ORDER_ID: "KG-1" })]);

    await expect(
      updateOrderRowValuesWithClient(sheets, env, "KG-1", { HACKED: "x" })
    ).rejects.toMatchObject({ status: 500 });
    expect(update).not.toHaveBeenCalled();
  });
});

/* ── Endpoint security ──────────────────────────────────────────── */

describe("admin order endpoint security", () => {
  it("rejects an unauthenticated order update", async () => {
    const request = new Request(
      "https://shop.example/api/admin/orders/KG-2026-AAAA1111",
      {
        method: "PATCH",
        headers: { origin: "https://shop.example", "content-type": "application/json" },
        body: JSON.stringify({ orderStatus: "shipped" })
      }
    );

    const response = await patchOrder(request, {
      params: Promise.resolve({ orderId: "KG-2026-AAAA1111" })
    });

    expect(response.status).toBe(401);
  });

  it("rejects an unauthenticated slip request", async () => {
    const request = new Request(
      "https://shop.example/api/admin/orders/KG-2026-AAAA1111/slip"
    );

    const response = await getSlip(request, {
      params: Promise.resolve({ orderId: "KG-2026-AAAA1111" })
    });
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).not.toContain("GOOGLE_DRIVE_REFRESH_TOKEN");
    expect(body).not.toContain("drive-1");
  });
});
