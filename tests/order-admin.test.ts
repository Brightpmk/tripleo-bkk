import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bangkokDayKey,
  calculateDashboardMetrics,
  defaultAdminOrderFilters,
  filterAdminOrders,
  matchesOrderSearch,
  parseOrderStatus,
  parsePaymentStatus,
  sortAdminOrders,
  type AdminOrderDetail,
  type AdminOrderSummary
} from "@/lib/orders-admin";
import type { AdminOrderRepository } from "@/lib/server/order-repository";
import { toOrderSummary } from "@/lib/server/order-repository";
import {
  getAdminDashboard,
  parseAdminOrderPatch,
  updateAdminOrder
} from "@/lib/server/order-admin-service";
import { PATCH as patchOrder } from "@/app/api/admin/orders/[orderId]/route";
import { GET as getSlip } from "@/app/api/admin/orders/[orderId]/slip/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

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

function detail(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    ...summary(),
    shippingAddress: "123 Test Road",
    notes: "private note",
    items: [
      {
        itemId: "KG-2026-AAAA1111-01",
        productId: "kg-bm-matcha",
        shirtColor: "Matcha",
        size: "M",
        quantity: 2,
        unitPriceThb: 390,
        lineTotalThb: 780
      }
    ],
    ...overrides
  };
}

describe("admin order DTOs", () => {
  it("strips address, notes, and items from the list summary DTO", () => {
    const listed = toOrderSummary(detail()) as Record<string, unknown>;

    expect(listed).not.toHaveProperty("shippingAddress");
    expect(listed).not.toHaveProperty("notes");
    expect(listed).not.toHaveProperty("items");
    expect(JSON.stringify(listed)).not.toContain("123 Test Road");
  });

  it("never exposes the slip file id in an order DTO", () => {
    const order = detail();

    expect(JSON.stringify(order)).not.toContain("drive-1");
    expect(order.hasSlip).toBe(true);
  });
});

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

describe("orders list behaviour", () => {
  const orders = [
    summary({
      orderId: "KG-2026-AAAA1111",
      customerName: "Ada Lovelace",
      phone: "0812345678",
      totalThb: 830,
      createdAtIso: "2026-08-30T04:00:00.000Z"
    }),
    summary({
      orderId: "KG-2026-BBBB2222",
      customerName: "Grace Hopper",
      phone: "0899999999",
      totalThb: 1200,
      createdAtIso: "2026-08-28T04:00:00.000Z",
      paymentStatus: "verified",
      orderStatus: "shipped",
      deliveryMethod: "pickup",
      universityId: "maejo"
    }),
    summary({
      orderId: "KG-2026-CCCC3333",
      customerName: "Alan Turing",
      phone: "0800000001",
      totalThb: 400,
      createdAtIso: "2026-08-29T04:00:00.000Z",
      orderStatus: "cancelled"
    })
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
      filterAdminOrders(orders, {
        ...defaultAdminOrderFilters,
        paymentStatus: "verified"
      })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, {
        ...defaultAdminOrderFilters,
        orderStatus: "cancelled"
      })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, {
        ...defaultAdminOrderFilters,
        deliveryMethod: "pickup"
      })
    ).toHaveLength(1);
    expect(
      filterAdminOrders(orders, {
        ...defaultAdminOrderFilters,
        universityId: "maejo"
      })
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

describe("dashboard metrics", () => {
  it("anchors 'today' to Bangkok midnight, not UTC", () => {
    expect(bangkokDayKey("2026-08-29T17:30:00.000Z")).toBe("2026-08-30");
    expect(bangkokDayKey("2026-08-29T16:30:00.000Z")).toBe("2026-08-29");
  });

  it("counts orders and revenue for the Bangkok day only", () => {
    const now = new Date("2026-08-30T03:00:00.000Z");
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
    expect(metrics.awaitingFulfillment).toBe(2);
    expect(metrics.shippedOrders).toBe(1);
  });

  it("builds the dashboard from a single repository read", async () => {
    const listOrders = vi.fn(async () => [detail()]);

    const dashboard = await getAdminDashboard(
      {
        listOrders,
        updateOrder: vi.fn(),
        getSlipFileId: vi.fn(),
        deleteOrder: vi.fn(async () => null)
      },
      new Date("2026-08-30T03:00:00.000Z")
    );

    expect(listOrders).toHaveBeenCalledTimes(1);
    expect(dashboard.metrics.totalOrders).toBe(1);
    expect(JSON.stringify(dashboard.recentOrders)).not.toContain("123 Test Road");
  });
});

describe("admin order mutations", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function repo(overrides: Partial<AdminOrderRepository> = {}): AdminOrderRepository {
    return {
      listOrders: vi.fn(async () => [detail()]),
      updateOrder: vi.fn(async () => undefined),
      getSlipFileId: vi.fn(async () => "drive-1"),
      deleteOrder: vi.fn(async () => null),
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
    const duplicate = detail();
    const repository = repo({
      listOrders: vi.fn(async () => [duplicate, duplicate])
    });

    await expect(
      updateAdminOrder("KG-2026-AAAA1111", { orderStatus: "shipped" }, repository)
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.updateOrder).not.toHaveBeenCalled();
  });
});

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
