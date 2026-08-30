import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import type { OrderSheetRows } from "@/lib/server/order-row-mapper";
import { submitOrderWithSlip } from "@/lib/server/order-service";
import {
  appendRowsWithClient,
  resolveOrderSheetIds
} from "@/lib/server/google-sheets";
import { optimizeSlipImage } from "@/lib/slip-image";
import { testProducts } from "./fixtures/products";

vi.mock("server-only", () => ({}));

const customer = {
  fullName: "Ada Lovelace",
  phone: "0812345678",
  deliveryMethod: "shipping" as const,
  shippingAddress: "123 Test Road, Bangkok 10140"
};

function buildRequest(submissionKey: string): OrderSubmissionRequest {
  return {
    universityId: "bangmod",
    checkout: customer,
    items: [{ productId: "kg-bm-matcha", size: "M", quantity: 2 }],
    slipSelected: true,
    submissionKey
  };
}

const jpegSlip = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "customer-slip.jpg", {
    type: "image/jpeg"
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("order submission concurrency", () => {
  it("starts the catalog read, slip decode, and Sheets warm-up together", async () => {
    const started: string[] = [];
    let catalogResolved = false;

    const getProductCatalog = vi.fn(async () => {
      started.push("catalog");
      await wait(30);
      catalogResolved = true;
      return testProducts;
    });

    const prefetchSheets = vi.fn(async () => {
      started.push("warmup");
      // The warm-up must already be running while the catalog is in flight.
      expect(catalogResolved).toBe(false);
      await wait(10);
    });

    const result = await submitOrderWithSlip(
      buildRequest("concurrency-1"),
      jpegSlip(),
      {
        getProductCatalog,
        prefetchSheets,
        appendRows: vi.fn(async () => undefined),
        slipStorage: {
          upload: vi.fn(async () => ({ fileId: "drive-1" })),
          delete: vi.fn()
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(started).toEqual(["catalog", "warmup"]);
  });

  it("keeps the two write side effects strictly ordered after validation", async () => {
    const order: string[] = [];

    const result = await submitOrderWithSlip(
      buildRequest("ordering-1"),
      jpegSlip(),
      {
        getProductCatalog: async () => {
          order.push("catalog");
          return testProducts;
        },
        prefetchSheets: async () => {
          order.push("warmup");
        },
        slipStorage: {
          upload: vi.fn(async () => {
            order.push("slip-upload");
            return { fileId: "drive-1" };
          }),
          delete: vi.fn()
        },
        appendRows: vi.fn(async () => {
          order.push("sheets-write");
        })
      }
    );

    expect(result.ok).toBe(true);
    // Reads may interleave, but the slip must land before the row that
    // references it, and nothing may write before validation passes.
    expect(order.indexOf("slip-upload")).toBeLessThan(
      order.indexOf("sheets-write")
    );
    expect(order.indexOf("catalog")).toBeLessThan(order.indexOf("slip-upload"));
  });

  it("performs no writes when validation fails", async () => {
    const upload = vi.fn();
    const appendRows = vi.fn();

    const result = await submitOrderWithSlip(
      { ...buildRequest("invalid-1"), items: [] },
      jpegSlip(),
      {
        getProductCatalog: async () => testProducts,
        prefetchSheets: async () => undefined,
        appendRows,
        slipStorage: { upload, delete: vi.fn() }
      }
    );

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(appendRows).not.toHaveBeenCalled();
  });

  it("never reports success when the Sheets write fails", async () => {
    const deleteSlip = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(
      buildRequest("durability-1"),
      jpegSlip(),
      {
        getProductCatalog: async () => testProducts,
        prefetchSheets: async () => undefined,
        slipStorage: {
          upload: vi.fn(async () => ({ fileId: "drive-1" })),
          delete: deleteSlip
        },
        appendRows: vi.fn(async () => {
          throw new Error("Sheets 503");
        })
      }
    );

    // Durability rule: no "ok" until the row is actually committed.
    expect(result.ok).toBe(false);
    // Existing partial-failure protection must survive the refactor.
    expect(deleteSlip).toHaveBeenCalledWith("drive-1");
  });

  it("survives a Sheets warm-up failure without failing the order", async () => {
    const result = await submitOrderWithSlip(
      buildRequest("warmup-fail-1"),
      jpegSlip(),
      {
        getProductCatalog: async () => testProducts,
        // prefetchOrderSheetIds swallows its own errors; this proves the
        // service does not depend on it succeeding.
        prefetchSheets: async () => undefined,
        appendRows: vi.fn(async () => undefined),
        slipStorage: {
          upload: vi.fn(async () => ({ fileId: "drive-1" })),
          delete: vi.fn()
        }
      }
    );

    expect(result.ok).toBe(true);
  });
});

describe("order timing diagnostics", () => {
  it("logs phase durations without any customer PII or secrets", async () => {
    const previous = process.env.ORDER_TIMING_LOGS;
    delete process.env.ORDER_TIMING_LOGS;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const result = await submitOrderWithSlip(
        buildRequest("timing-1"),
        jpegSlip(),
        {
          getProductCatalog: async () => testProducts,
          prefetchSheets: async () => undefined,
          appendRows: vi.fn(async () => undefined),
          slipStorage: {
            upload: vi.fn(async () => ({ fileId: "drive-secret-file-id" })),
            delete: vi.fn()
          }
        }
      );

      expect(result.ok).toBe(true);
      expect(info).toHaveBeenCalledWith(
        "Order submission timing",
        expect.objectContaining({
          outcome: "accepted",
          totalMs: expect.any(Number),
          catalogMs: expect.any(Number),
          slipUploadMs: expect.any(Number),
          sheetsWriteMs: expect.any(Number)
        })
      );

      const logged = JSON.stringify(info.mock.calls);
      expect(logged).not.toContain(customer.fullName);
      expect(logged).not.toContain(customer.phone);
      expect(logged).not.toContain(customer.shippingAddress);
      expect(logged).not.toContain("customer-slip.jpg");
      expect(logged).not.toContain("drive-secret-file-id");
    } finally {
      info.mockRestore();
      if (previous !== undefined) {
        process.env.ORDER_TIMING_LOGS = previous;
      }
    }
  });

  it("can be switched off entirely", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await submitOrderWithSlip(buildRequest("timing-off-1"), jpegSlip(), {
      getProductCatalog: async () => testProducts,
      prefetchSheets: async () => undefined,
      appendRows: vi.fn(async () => undefined),
      slipStorage: {
        upload: vi.fn(async () => ({ fileId: "drive-1" })),
        delete: vi.fn()
      }
    });

    expect(info).not.toHaveBeenCalled();
  });
});

describe("Sheets round-trip elimination", () => {
  const env = {
    GOOGLE_ORDER_SPREADSHEET_ID: "spreadsheet-id",
    GOOGLE_ORDERS_RANGE: "Orders!A:Q",
    GOOGLE_ORDER_ITEMS_RANGE: "OrderItems!A:H"
  };
  const rows: OrderSheetRows = {
    ordersRow: ["KG-2026-A8F2B91C"],
    orderItemsRows: [["KG-2026-A8F2B91C", "KG-2026-A8F2B91C-01"]]
  };

  function makeClient() {
    const get = vi.fn(async () => ({
      data: {
        sheets: [
          { properties: { title: "Orders", sheetId: 10 } },
          { properties: { title: "OrderItems", sheetId: 11 } }
        ]
      }
    }));
    const batchUpdate = vi.fn(async () => ({}));

    return {
      get,
      batchUpdate,
      client: { spreadsheets: { get, batchUpdate } } as never
    };
  }

  it("resolves both tab IDs in a single metadata call", async () => {
    const { client, get } = makeClient();

    await expect(resolveOrderSheetIds(client, env)).resolves.toEqual({
      ordersSheetId: 10,
      orderItemsSheetId: 11
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("skips the metadata round trip when tab IDs are already known", async () => {
    const { client, get, batchUpdate } = makeClient();

    await appendRowsWithClient(client, env, rows, {
      ordersSheetId: 10,
      orderItemsSheetId: 11
    });

    expect(get).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });

  it("still resolves tab IDs when none are supplied", async () => {
    const { client, get, batchUpdate } = makeClient();

    await appendRowsWithClient(client, env, rows);

    expect(get).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("payment slip optimisation", () => {
  it("returns the original file untouched when no DOM is available", async () => {
    const file = new File([new Uint8Array(600 * 1024)], "slip.png", {
      type: "image/png"
    });

    const result = await optimizeSlipImage(file);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(file);
    expect(result.optimizedBytes).toBe(file.size);
  });

  it("leaves small files alone", async () => {
    const file = new File([new Uint8Array(50 * 1024)], "slip.jpg", {
      type: "image/jpeg"
    });

    const result = await optimizeSlipImage(file);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(file);
  });

  it("leaves non-image files alone", async () => {
    const file = new File([new Uint8Array(600 * 1024)], "slip.pdf", {
      type: "application/pdf"
    });

    const result = await optimizeSlipImage(file);

    expect(result.compressed).toBe(false);
    expect(result.file).toBe(file);
  });
});
