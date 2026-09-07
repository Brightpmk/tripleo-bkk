import { describe, expect, it, vi } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import type { ConfirmedOrder } from "@/lib/orders";
import { submitOrderWithSlip } from "@/lib/server/order-service";
import { testProducts } from "./fixtures/products";

vi.mock("server-only", () => ({}));

const validSlip = () =>
  new File([new Uint8Array(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  ))], "customer-slip.png", {
    type: "image/png"
  });

function buildRequest(submissionKey: string): OrderSubmissionRequest {
  return {
    universityId: "bangmod",
    checkout: {
      fullName: "Ada Lovelace",
      phone: "0812345678",
      deliveryMethod: "shipping",
      shippingAddress: "123 Test Road"
    },
    items: [
      {
        productId: "kg-bm-matcha",
        size: "M",
        quantity: 2
      }
    ],
    slipSelected: true,
    submissionKey
  };
}

describe("order service slip persistence", () => {
  it("uploads a valid slip and persists its opaque storage reference", async () => {
    const upload = vi.fn(async () => ({ fileId: "blob:v1:payment-slips/test" }));
    let persistedOrder: ConfirmedOrder | undefined;
    const persistOrder = vi.fn(async (order: ConfirmedOrder) => {
      persistedOrder = order;
    });

    const result = await submitOrderWithSlip(buildRequest("upload-success"), validSlip(), {
      getProductCatalog: async () => testProducts,
      persistOrder,
      slipStorage: {
        upload,
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(persistOrder).toHaveBeenCalledTimes(1);
    expect(persistedOrder?.paymentStatus).toBe("pending");
    expect(persistedOrder?.slipFileId).toBe("blob:v1:payment-slips/test");
  });

  it("does not leak storage details in the success response", async () => {
    const result = await submitOrderWithSlip(buildRequest("privacy-success"), validSlip(), {
      getProductCatalog: async () => testProducts,
      persistOrder: vi.fn(async () => undefined),
      slipStorage: {
        upload: vi.fn(async () => ({ fileId: "drive-file-secret" })),
        delete: vi.fn()
      }
    });

    const responseJson = JSON.stringify(result);

    expect(result.ok).toBe(true);
    expect(responseJson).not.toContain("drive-file-secret");
    expect(responseJson).not.toContain("GOOGLE_DRIVE_SLIP_FOLDER_ID");
  });

  it("does not persist the order when Blob upload fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const persistOrder = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("drive-fails"), validSlip(), {
      getProductCatalog: async () => testProducts,
      persistOrder,
      slipStorage: {
        upload: vi.fn(async () => {
          throw new Error("Blob unavailable");
        }),
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(persistOrder).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Order persistence failed", expect.objectContaining({
      operation: "blob-slip-upload"
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("customer-slip");
    consoleError.mockRestore();
  });

  it("does not report success and attempts cleanup if Supabase persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deleteSlip = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("supabase-fails"), validSlip(), {
      getProductCatalog: async () => testProducts,
      persistOrder: vi.fn(async () => {
        throw new Error("Supabase unavailable");
      }),
      slipStorage: {
        upload: vi.fn(async () => ({ fileId: "drive-file-456" })),
        delete: deleteSlip
      }
    });

    expect(result.ok).toBe(false);
    expect(deleteSlip).toHaveBeenCalledWith("drive-file-456");
    expect(consoleError).toHaveBeenCalledWith("Order persistence failed", expect.objectContaining({
      operation: "supabase-create-order"
    }));
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("customer-slip");
    consoleError.mockRestore();
  });

  it("rejects a missing slip before upload or Supabase persistence", async () => {
    const upload = vi.fn(async () => ({ fileId: "drive-file-789" }));
    const persistOrder = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("missing-slip"), null, {
      getProductCatalog: async () => testProducts,
      persistOrder,
      slipStorage: {
        upload,
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(persistOrder).not.toHaveBeenCalled();
  });

  it("does not fall back to fictional products when catalog loading fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upload = vi.fn(async () => ({ fileId: "drive-file-789" }));
    const persistOrder = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("catalog-fails"), validSlip(), {
      getProductCatalog: async () => {
        throw new Error("Products unavailable");
      },
      persistOrder,
      slipStorage: {
        upload,
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    // The customer sees a generic Thai retry message, never a backend detail.
    expect(result.ok ? undefined : result.message).toBe(
      "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
    );
    expect(upload).not.toHaveBeenCalled();
    expect(persistOrder).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
