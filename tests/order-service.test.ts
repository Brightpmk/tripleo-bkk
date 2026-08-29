import { describe, expect, it, vi } from "vitest";
import type { OrderSubmissionRequest } from "@/lib/order-submission";
import type { OrderSheetRows } from "@/lib/server/order-row-mapper";
import { submitOrderWithSlip } from "@/lib/server/order-service";

vi.mock("server-only", () => ({}));

const jpegSlip = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "customer-slip.jpg", {
    type: "image/jpeg"
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
  it("uploads a valid slip and persists its Drive file ID", async () => {
    const upload = vi.fn(async () => ({ fileId: "drive-file-123" }));
    let persistedRows: OrderSheetRows | undefined;
    const appendRows = vi.fn(async (rows: OrderSheetRows) => {
      persistedRows = rows;
    });

    const result = await submitOrderWithSlip(buildRequest("upload-success"), jpegSlip(), {
      appendRows,
      slipStorage: {
        upload,
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(appendRows).toHaveBeenCalledTimes(1);
    expect(persistedRows?.ordersRow[10]).toBe("PENDING");
    expect(persistedRows?.ordersRow[11]).toBe("drive-file-123");
  });

  it("does not leak Drive details in the success response", async () => {
    const result = await submitOrderWithSlip(buildRequest("privacy-success"), jpegSlip(), {
      appendRows: vi.fn(async () => undefined),
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

  it("does not persist the order when Drive upload fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const appendRows = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("drive-fails"), jpegSlip(), {
      appendRows,
      slipStorage: {
        upload: vi.fn(async () => {
          throw new Error("Drive unavailable");
        }),
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(appendRows).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("customer-slip");
    consoleError.mockRestore();
  });

  it("does not report success and attempts cleanup if Sheets fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deleteSlip = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("sheets-fails"), jpegSlip(), {
      appendRows: vi.fn(async () => {
        throw new Error("Sheets unavailable");
      }),
      slipStorage: {
        upload: vi.fn(async () => ({ fileId: "drive-file-456" })),
        delete: deleteSlip
      }
    });

    expect(result.ok).toBe(false);
    expect(deleteSlip).toHaveBeenCalledWith("drive-file-456");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("customer-slip");
    consoleError.mockRestore();
  });

  it("rejects a missing slip before upload or Sheets persistence", async () => {
    const upload = vi.fn(async () => ({ fileId: "drive-file-789" }));
    const appendRows = vi.fn(async () => undefined);

    const result = await submitOrderWithSlip(buildRequest("missing-slip"), null, {
      appendRows,
      slipStorage: {
        upload,
        delete: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(appendRows).not.toHaveBeenCalled();
  });
});
