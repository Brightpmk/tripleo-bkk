import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import { submitOrderWithSlip } from "@/lib/server/order-service";
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

const validSlip = () =>
  new File([new Uint8Array(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ))], "customer-slip.png", {
    type: "image/png"
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("order submission concurrency", () => {
  it("starts catalog loading before any write side effects", async () => {
    const started: string[] = [];

    const getProductCatalog = vi.fn(async () => {
      started.push("catalog");
      await wait(30);
      return testProducts;
    });

    const result = await submitOrderWithSlip(
      buildRequest("concurrency-1"),
      validSlip(),
      {
        getProductCatalog,
        persistOrder: vi.fn(async () => {
          started.push("order-write");
        }),
        slipStorage: {
          upload: vi.fn(async () => {
            started.push("slip-upload");
            return { fileId: "drive-1" };
          }),
          delete: vi.fn()
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(started[0]).toBe("catalog");
    expect(started.indexOf("catalog")).toBeLessThan(
      started.indexOf("slip-upload")
    );
    expect(started.indexOf("catalog")).toBeLessThan(
      started.indexOf("order-write")
    );
  });

  it("keeps the two write side effects strictly ordered after validation", async () => {
    const order: string[] = [];

    const result = await submitOrderWithSlip(
      buildRequest("ordering-1"),
      validSlip(),
      {
        getProductCatalog: async () => {
          order.push("catalog");
          return testProducts;
        },
        slipStorage: {
          upload: vi.fn(async () => {
            order.push("slip-upload");
            return { fileId: "drive-1" };
          }),
          delete: vi.fn()
        },
        persistOrder: vi.fn(async () => {
          order.push("order-write");
        })
      }
    );

    expect(result.ok).toBe(true);
    // Reads may interleave, but the slip must land before the row that
    // references it, and nothing may write before validation passes.
    expect(order.indexOf("slip-upload")).toBeLessThan(
      order.indexOf("order-write")
    );
    expect(order.indexOf("catalog")).toBeLessThan(order.indexOf("slip-upload"));
  });

  it("performs no writes when validation fails", async () => {
    const upload = vi.fn();
    const persistOrder = vi.fn();

    const result = await submitOrderWithSlip(
      { ...buildRequest("invalid-1"), items: [] },
      validSlip(),
      {
        getProductCatalog: async () => testProducts,
        persistOrder,
        slipStorage: { upload, delete: vi.fn() }
      }
    );

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(persistOrder).not.toHaveBeenCalled();
  });

  it("never reports success when the Supabase transaction fails", async () => {
    const deleteSlip = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(
      buildRequest("durability-1"),
      validSlip(),
      {
        getProductCatalog: async () => testProducts,
        slipStorage: {
          upload: vi.fn(async () => ({ fileId: "drive-1" })),
          delete: deleteSlip
        },
        persistOrder: vi.fn(async () => {
          throw new Error("Supabase 503");
        })
      }
    );

    // Durability rule: no "ok" until the row is actually committed.
    expect(result.ok).toBe(false);
    // Existing partial-failure protection must survive the refactor.
    expect(deleteSlip).toHaveBeenCalledWith("drive-1");
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
        validSlip(),
        {
          getProductCatalog: async () => testProducts,
          persistOrder: vi.fn(async () => undefined),
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
          orderWriteMs: expect.any(Number)
        })
      );

      const logged = JSON.stringify(info.mock.calls);
      expect(logged).not.toContain(customer.fullName);
      expect(logged).not.toContain(customer.phone);
      expect(logged).not.toContain(customer.shippingAddress);
      expect(logged).not.toContain("customer-slip.png");
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

    await submitOrderWithSlip(buildRequest("timing-off-1"), validSlip(), {
      getProductCatalog: async () => testProducts,
      persistOrder: vi.fn(async () => undefined),
      slipStorage: {
        upload: vi.fn(async () => ({ fileId: "drive-1" })),
        delete: vi.fn()
      }
    });

    expect(info).not.toHaveBeenCalled();
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
