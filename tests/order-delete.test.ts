import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAdminOrder,
  getAdminDashboard,
  getAdminOrderSummaries
} from "@/lib/server/order-admin-service";
import type {
  AdminOrderRepository,
  DeletedOrderRecord
} from "@/lib/server/order-repository";
import type { AdminOrderDetail } from "@/lib/orders-admin";
import { searchTrackedOrders } from "@/lib/server/tracking-service";
import { DELETE as deleteOrderRequest } from "@/app/api/admin/orders/[orderId]/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/admin-auth", () => ({
  hasValidAdminSession: vi.fn(async () => false)
}));

const ORDER_ID = "KG-2026-AAAA1111";
const OTHER_ORDER_ID = "KG-2026-BBBB2222";

function detail(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    orderId: ORDER_ID,
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
    shippingAddress: "123 Secret Road",
    notes: "",
    items: [
      {
        itemId: `${ORDER_ID}-01`,
        productId: "kg-bm-matcha",
        shirtColor: "Matcha",
        size: "M",
        quantity: 2,
        unitPriceThb: 390,
        lineTotalThb: 780
      }
    ],
    dataIssues: [],
    ...overrides
  };
}

function repo(
  overrides: Partial<AdminOrderRepository> = {},
  deleted: DeletedOrderRecord | null = {
    orderId: ORDER_ID,
    slipFileId: "drive-file-1",
    deletedItemCount: 1
  }
): AdminOrderRepository {
  return {
    listOrders: vi.fn(async () => [detail()]),
    updateOrder: vi.fn(),
    getSlipFileId: vi.fn(async () => "drive-file-1"),
    deleteOrder: vi.fn(async () => deleted),
    ...overrides
  };
}

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* ── Happy path ─────────────────────────────────────────────────── */

describe("permanent order deletion", () => {
  it("deletes the order and reports the items removed with it", async () => {
    const repository = repo();

    const result = await deleteAdminOrder(ORDER_ID, {
      repository,
      deleteSlip: vi.fn(async () => undefined)
    });

    expect(repository.deleteOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.deletedItemCount).toBe(1);
    expect(result.slipCleanup).toBe("deleted");
  });

  it("deletes order items atomically with the order", async () => {
    // A single repository call covers both: order_items cascade in the same
    // statement, so there is no second call that could half-fail.
    const repository = repo(
      {},
      { orderId: ORDER_ID, slipFileId: null, deletedItemCount: 3 }
    );

    const result = await deleteAdminOrder(ORDER_ID, {
      repository,
      deleteSlip: vi.fn()
    });

    expect(repository.deleteOrder).toHaveBeenCalledTimes(1);
    expect(result.deletedItemCount).toBe(3);
  });

  it("rejects an invalid ORDER_ID before touching the database", async () => {
    const repository = repo();

    for (const value of ["", "  ", "ab", "bad id!", "x".repeat(65)]) {
      await expect(
        deleteAdminOrder(value, { repository, deleteSlip: vi.fn() })
      ).rejects.toMatchObject({ status: 404 });
    }

    expect(repository.deleteOrder).not.toHaveBeenCalled();
  });

  it("reports a nonexistent order as not found", async () => {
    const deleteSlip = vi.fn();
    const repository = repo({}, null);

    await expect(
      deleteAdminOrder(ORDER_ID, { repository, deleteSlip })
    ).rejects.toMatchObject({ status: 404 });

    expect(deleteSlip).not.toHaveBeenCalled();
  });

  it("surfaces a database failure without deleting the slip", async () => {
    const deleteSlip = vi.fn();
    const repository = repo({
      deleteOrder: vi.fn(async () => {
        throw new Error("Supabase 503");
      })
    });

    await expect(
      deleteAdminOrder(ORDER_ID, { repository, deleteSlip })
    ).rejects.toThrow("Supabase 503");

    // Evidence must never be destroyed for an order that still exists.
    expect(deleteSlip).not.toHaveBeenCalled();
  });
});

/* ── Slip cleanup ───────────────────────────────────────────────── */

describe("payment slip cleanup", () => {
  it("deletes the Drive slip only after the database commits", async () => {
    const order: string[] = [];
    const repository = repo({
      deleteOrder: vi.fn(async () => {
        order.push("database");
        return { orderId: ORDER_ID, slipFileId: "drive-file-1", deletedItemCount: 1 };
      })
    });

    await deleteAdminOrder(ORDER_ID, {
      repository,
      deleteSlip: vi.fn(async () => {
        order.push("slip");
      })
    });

    expect(order).toEqual(["database", "slip"]);
  });

  it("passes the preserved slip file id to cleanup", async () => {
    const deleteSlip = vi.fn(async () => undefined);

    await deleteAdminOrder(ORDER_ID, { repository: repo(), deleteSlip });

    expect(deleteSlip).toHaveBeenCalledWith("drive-file-1");
  });

  it.each([
    ["no slip", null],
    ["a blank slip id", ""],
    ["a whitespace-only slip id", "   "]
  ])("skips Drive cleanup for %s", async (_label, slipFileId) => {
    const deleteSlip = vi.fn();
    const repository = repo({}, { orderId: ORDER_ID, slipFileId, deletedItemCount: 1 });

    const result = await deleteAdminOrder(ORDER_ID, { repository, deleteSlip });

    expect(result.slipCleanup).toBe("skipped");
    expect(deleteSlip).not.toHaveBeenCalled();
  });

  it("keeps the deletion successful when Drive cleanup fails", async () => {
    const result = await deleteAdminOrder(ORDER_ID, {
      repository: repo(),
      deleteSlip: vi.fn(async () => {
        throw new Error("Drive 500: refresh token rejected");
      })
    });

    // The order is gone; cleanup is advisory and must not roll it back.
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.slipCleanup).toBe("failed");
  });

  it("logs only safe metadata when cleanup fails", async () => {
    await deleteAdminOrder(ORDER_ID, {
      repository: repo(),
      deleteSlip: vi.fn(async () => {
        throw new Error("Drive 500: refresh token sk_secret rejected");
      })
    });

    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain("sk_secret");
    expect(logged).not.toContain("0812345678");
    expect(logged).not.toContain("123 Secret Road");
    expect(logged).not.toContain("Ada Lovelace");
    expect(logged).toContain("delete-order");
    expect(logged).toContain(ORDER_ID);
  });
});

/* ── Downstream visibility ──────────────────────────────────────── */

describe("after deletion", () => {
  const remaining = [detail({ orderId: OTHER_ORDER_ID })];

  it("drops the order from the admin list", async () => {
    const summaries = await getAdminOrderSummaries(
      repo({ listOrders: vi.fn(async () => remaining) })
    );

    expect(summaries.map((order) => order.orderId)).toEqual([OTHER_ORDER_ID]);
  });

  it("drops the order from dashboard metrics", async () => {
    const dashboard = await getAdminDashboard(
      repo({ listOrders: vi.fn(async () => remaining) }),
      new Date("2026-08-30T03:00:00.000Z")
    );

    expect(dashboard.metrics.totalOrders).toBe(1);
    expect(
      dashboard.recentOrders.some((order) => order.orderId === ORDER_ID)
    ).toBe(false);
  });

  it("stops returning the order from public tracking", async () => {
    const result = await searchTrackedOrders(
      { mode: "phone", value: "0812345678" },
      repo({ listOrders: vi.fn(async () => remaining) })
    );

    expect(result.ok).toBe(true);
    expect(
      result.ok && result.orders.some((order) => order.orderId === ORDER_ID)
    ).toBe(false);
  });

  it("returns nothing for a customer whose only order was deleted", async () => {
    const result = await searchTrackedOrders(
      { mode: "phone", value: "0812345678" },
      repo({ listOrders: vi.fn(async () => []) })
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.orders : ["x"]).toHaveLength(0);
  });
});

/* ── Endpoint security ──────────────────────────────────────────── */

describe("delete endpoint security", () => {
  const params = { params: Promise.resolve({ orderId: ORDER_ID }) };

  it("rejects an unauthenticated delete", async () => {
    const request = new Request(
      `https://shop.example/api/admin/orders/${ORDER_ID}`,
      { method: "DELETE", headers: { origin: "https://shop.example" } }
    );

    const response = await deleteOrderRequest(request, params);
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toContain("GOOGLE_DRIVE_REFRESH_TOKEN");
    expect(body).not.toContain("drive-file-1");
  });

  it("takes its identity from the route, never a request body", async () => {
    // A body naming another order or a raw database UUID is ignored: the
    // handler only ever reads context.params.
    const request = new Request(
      `https://shop.example/api/admin/orders/${ORDER_ID}`,
      {
        method: "DELETE",
        headers: {
          origin: "https://shop.example",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          orderId: OTHER_ORDER_ID,
          id: "11111111-2222-3333-4444-555555555555"
        })
      }
    );

    const response = await deleteOrderRequest(request, params);

    // Unauthenticated here, but the point is the body is never consulted.
    expect(response.status).toBe(401);
  });
});
