import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTrackingTimeline,
  normalizeTrackingName,
  normalizeTrackingPhone,
  validateTrackingQuery,
  type PublicTrackedOrder
} from "@/lib/tracking";
import type { AdminOrderDetail } from "@/lib/orders-admin";
import {
  searchTrackedOrders,
  toPublicTrackedOrder,
  TrackingUnavailableError
} from "@/lib/server/tracking-service";
import { clearTrackingRateLimitForTests } from "@/lib/server/tracking-rate-limit";
import { POST as trackingRequest } from "@/app/api/tracking/route";
import type { AdminOrderRepository } from "@/lib/server/order-repository";

vi.mock("server-only", () => ({}));

function order(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
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
    shippingAddress: "123 Secret Road, Bangkok 10140",
    notes: "internal note",
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
    dataIssues: [],
    ...overrides
  };
}

function repo(orders: AdminOrderDetail[]): AdminOrderRepository {
  return {
    listOrders: vi.fn(async () => orders),
    updateOrder: vi.fn(),
    getSlipFileId: vi.fn(async () => "drive-secret-1"),
    deleteOrder: vi.fn(async () => null)
  };
}

async function search(mode: unknown, value: unknown, orders: AdminOrderDetail[]) {
  return searchTrackedOrders({ mode, value }, repo(orders));
}

/* ── Normalisation ──────────────────────────────────────────────── */

describe("tracking query normalisation", () => {
  it("collapses repeated whitespace and casefolds names", () => {
    expect(normalizeTrackingName("  Ada   LOVELACE  ")).toBe("ada lovelace");
  });

  it("strips spaces and hyphens from phones", () => {
    expect(normalizeTrackingPhone("081-234 5678")).toBe("0812345678");
    expect(normalizeTrackingPhone("081 234 5678")).toBe("0812345678");
  });

  it("preserves the leading zero", () => {
    expect(normalizeTrackingPhone("0812345678")).toBe("0812345678");
    expect(normalizeTrackingPhone("0812345678").startsWith("0")).toBe(true);
  });

  it("folds a +66 country code to the national form", () => {
    expect(normalizeTrackingPhone("+66 81 234 5678")).toBe("0812345678");
  });
});

describe("tracking query validation", () => {
  it("rejects an empty search", () => {
    expect(validateTrackingQuery("name", "").ok).toBe(false);
    expect(validateTrackingQuery("phone", "   ").ok).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(validateTrackingQuery("email", "a@b.com").ok).toBe(false);
  });

  it("rejects oversized input", () => {
    expect(validateTrackingQuery("name", "x".repeat(81)).ok).toBe(false);
    expect(validateTrackingQuery("phone", "1".repeat(25)).ok).toBe(false);
  });

  it("rejects a phone too short to be a real number", () => {
    expect(validateTrackingQuery("phone", "0812").ok).toBe(false);
  });

  it("rejects a name too short to identify anyone", () => {
    expect(validateTrackingQuery("name", "ab").ok).toBe(false);
  });

  it("accepts a valid name and phone", () => {
    expect(validateTrackingQuery("name", " Ada  Lovelace ")).toEqual({
      ok: true,
      mode: "name",
      normalized: "ada lovelace"
    });
    expect(validateTrackingQuery("phone", "081-234-5678")).toEqual({
      ok: true,
      mode: "phone",
      normalized: "0812345678"
    });
  });
});

/* ── Search ─────────────────────────────────────────────────────── */

describe("tracking search", () => {
  it("finds an order by full name", async () => {
    const result = await search("name", "Ada Lovelace", [order()]);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.orders : []).toHaveLength(1);
  });

  it("matches names case-insensitively and ignores repeated spaces", async () => {
    const result = await search("name", "  ada   LOVELACE ", [order()]);

    expect(result.ok && result.orders).toHaveLength(1);
  });

  it("finds an order by phone with formatting", async () => {
    const result = await search("phone", "081-234 5678", [order()]);

    expect(result.ok && result.orders).toHaveLength(1);
  });

  it("returns no results for a non-matching lookup", async () => {
    const result = await search("phone", "0899999999", [order()]);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.orders : ["x"]).toHaveLength(0);
  });

  it("does not match on a partial name — no enumeration", async () => {
    const result = await search("name", "Ada", [order()]);

    expect(result.ok ? result.orders : ["x"]).toHaveLength(0);
  });

  it("rejects an empty query before touching the repository", async () => {
    const repository = repo([order()]);
    const result = await searchTrackedOrders({ mode: "name", value: "" }, repository);

    expect(result.ok).toBe(false);
    expect(repository.listOrders).not.toHaveBeenCalled();
  });

  it("returns every matching order, newest first, without merging them", async () => {
    const result = await search("phone", "0812345678", [
      order({ orderId: "KG-A", createdAtIso: "2026-08-28T04:00:00.000Z" }),
      order({ orderId: "KG-C", createdAtIso: "2026-08-30T04:00:00.000Z" }),
      order({ orderId: "KG-B", createdAtIso: "2026-08-29T04:00:00.000Z" })
    ]);

    expect(result.ok && result.orders.map((o) => o.orderId)).toEqual([
      "KG-C",
      "KG-B",
      "KG-A"
    ]);
  });

  it("reads the repository once per lookup", async () => {
    const repository = repo([order()]);
    await searchTrackedOrders({ mode: "phone", value: "0812345678" }, repository);

    expect(repository.listOrders).toHaveBeenCalledTimes(1);
  });
});

/* ── Items ──────────────────────────────────────────────────────── */

describe("tracked order items", () => {
  it("returns a single item with its quantity", async () => {
    const result = await search("phone", "0812345678", [order()]);
    const tracked = result.ok ? result.orders[0] : null;

    expect(tracked?.items).toEqual([
      { shirtColor: "Matcha", size: "M", quantity: 2 }
    ]);
  });

  it("returns multiple items and the total count", async () => {
    const result = await search("phone", "0812345678", [
      order({
        itemCount: 5,
        items: [
          {
            itemId: "1",
            productId: "p1",
            shirtColor: "Matcha",
            size: "M",
            quantity: 2,
            unitPriceThb: 390,
            lineTotalThb: 780
          },
          {
            itemId: "2",
            productId: "p2",
            shirtColor: "Charcoal",
            size: "4XL",
            quantity: 3,
            unitPriceThb: 265,
            lineTotalThb: 795
          }
        ]
      })
    ]);
    const tracked = result.ok ? result.orders[0] : null;

    expect(tracked?.items).toHaveLength(2);
    expect(tracked?.items[1].quantity).toBe(3);
    expect(tracked?.itemCount).toBe(5);
  });

  it("never exposes item prices to the public DTO", async () => {
    const result = await search("phone", "0812345678", [order()]);
    const item = result.ok ? result.orders[0].items[0] : null;

    expect(item).not.toHaveProperty("unitPriceThb");
    expect(item).not.toHaveProperty("lineTotalThb");
  });
});

/* ── Status & timeline ──────────────────────────────────────────── */

describe("tracking status presentation", () => {
  it.each([
    ["new", 0],
    ["preparing", 1],
    ["shipped", 2],
    ["completed", 3]
  ] as const)("marks %s complete up to its own stage only", (status, reached) => {
    const timeline = buildTrackingTimeline(status);

    expect(timeline.cancelled).toBe(false);
    timeline.steps.forEach((step, index) => {
      expect(step.complete).toBe(index <= reached);
      expect(step.current).toBe(index === reached);
    });
  });

  it("never marks a future stage complete", () => {
    const timeline = buildTrackingTimeline("preparing");

    expect(timeline.steps[2].complete).toBe(false);
    expect(timeline.steps[3].complete).toBe(false);
  });

  it("stops the timeline for a cancelled order", () => {
    const timeline = buildTrackingTimeline("cancelled");

    expect(timeline.cancelled).toBe(true);
    expect(timeline.steps).toHaveLength(0);
  });

  it("carries pending payment through untouched by fulfilment status", async () => {
    const result = await search("phone", "0812345678", [
      order({ paymentStatus: "pending", orderStatus: "shipped" })
    ]);
    const tracked = result.ok ? result.orders[0] : null;

    // A slip on file never implies payment; the stored status is used as-is.
    expect(tracked?.paymentStatus).toBe("pending");
    expect(tracked?.orderStatus).toBe("shipped");
  });

  it("keeps shipping provider and tracking number for a shipped order", async () => {
    const result = await search("phone", "0812345678", [
      order({
        orderStatus: "shipped",
        shippingProvider: "Kerry",
        trackingNumber: "TH1234567890"
      })
    ]);
    const tracked = result.ok ? result.orders[0] : null;

    expect(tracked?.shippingProvider).toBe("Kerry");
    expect(tracked?.trackingNumber).toBe("TH1234567890");
  });

  it("returns empty shipping fields when tracking is not set yet", async () => {
    const result = await search("phone", "0812345678", [
      order({ deliveryMethod: "shipping", trackingNumber: "" })
    ]);
    const tracked = result.ok ? result.orders[0] : null;

    expect(tracked?.deliveryMethod).toBe("shipping");
    expect(tracked?.trackingNumber).toBe("");
  });

  it("strips shipping fields entirely for a pickup order", async () => {
    const result = await search("phone", "0812345678", [
      order({
        deliveryMethod: "pickup",
        shippingProvider: "Kerry",
        trackingNumber: "TH1234567890"
      })
    ]);
    const tracked = result.ok ? result.orders[0] : null;

    expect(tracked?.deliveryMethod).toBe("pickup");
    expect(tracked?.shippingProvider).toBe("");
    expect(tracked?.trackingNumber).toBe("");
  });

  it.each(["completed", "cancelled"] as const)(
    "passes %s through from the stored order status",
    async (orderStatus) => {
      const result = await search("phone", "0812345678", [order({ orderStatus })]);

      expect(result.ok && result.orders[0].orderStatus).toBe(orderStatus);
    }
  );
});

/* ── Privacy ────────────────────────────────────────────────────── */

describe("public tracking privacy", () => {
  it("omits every admin-only field from the DTO", () => {
    const tracked = toPublicTrackedOrder(order()) as Record<string, unknown>;

    for (const field of [
      "shippingAddress",
      "phone",
      "customerName",
      "notes",
      "hasSlip",
      "slipFileId",
      "dataIssues",
      "subtotalThb",
      "shippingFeeThb",
      "universityId"
    ]) {
      expect(tracked).not.toHaveProperty(field);
    }
  });

  it("leaks no address, phone, slip, or database metadata in the payload", async () => {
    const result = await search("phone", "0812345678", [order()]);
    const payload = JSON.stringify(result);

    expect(payload).not.toContain("123 Secret Road");
    expect(payload).not.toContain("0812345678");
    expect(payload).not.toContain("Ada Lovelace");
    expect(payload).not.toContain("internal note");
    expect(payload).not.toContain("drive-secret-1");
    expect(payload).not.toContain("blob:v1:payment-slips/");
    expect(payload).not.toContain("SHIPPING_ADDRESS");
    expect(payload).not.toContain("SLIP_FILE_ID");
    expect(payload).not.toContain("spreadsheet");
  });

  it("exposes exactly the intended public fields", () => {
    const tracked = toPublicTrackedOrder(order());
    const expected: (keyof PublicTrackedOrder)[] = [
      "orderId",
      "placedAtIso",
      "universityBrand",
      "items",
      "itemCount",
      "totalThb",
      "paymentStatus",
      "orderStatus",
      "deliveryMethod",
      "shippingProvider",
      "trackingNumber"
    ];

    expect(Object.keys(tracked).sort()).toEqual([...expected].sort());
  });

  it("never calls the slip accessor during a lookup", async () => {
    const repository = repo([order()]);
    await searchTrackedOrders({ mode: "phone", value: "0812345678" }, repository);

    expect(repository.getSlipFileId).not.toHaveBeenCalled();
  });
});

/* ── Errors ─────────────────────────────────────────────────────── */

describe("tracking failure handling", () => {
  it("throws a generic error when the repository fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const repository: AdminOrderRepository = {
      listOrders: vi.fn(async () => {
        throw new Error("Supabase 503: table orders not reachable");
      }),
      updateOrder: vi.fn(),
      getSlipFileId: vi.fn(),
      deleteOrder: vi.fn(async () => null)
    };

    await expect(
      searchTrackedOrders({ mode: "phone", value: "0812345678" }, repository)
    ).rejects.toBeInstanceOf(TrackingUnavailableError);

    // The log must not carry the query value or storage internals.
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("0812345678");
    expect(logged).not.toContain("table orders");
    expect(logged).toContain("errorName");
    error.mockRestore();
  });
});

/* ── Public endpoint ────────────────────────────────────────────── */

describe("public tracking endpoint", () => {
  beforeEach(() => {
    clearTrackingRateLimitForTests();
  });

  function post(body: unknown, ip = "203.0.113.10") {
    return new Request("https://shop.example/api/tracking", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body)
    });
  }

  it("rejects an empty query with a 400 and a safe message", async () => {
    const response = await trackingRequest(post({ mode: "name", value: "" }));
    const body = (await response.json()) as { ok: boolean; message: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.message).not.toContain("Sheet");
  });

  it("rejects a malformed body", async () => {
    const request = new Request("https://shop.example/api/tracking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json"
    });

    expect((await trackingRequest(request)).status).toBe(400);
  });

  it("never caches a lookup response", async () => {
    const response = await trackingRequest(post({ mode: "name", value: "" }));

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("rate limits repeated lookups from one source", async () => {
    let lastStatus = 200;

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await trackingRequest(post({ mode: "phone", value: "" }));
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
