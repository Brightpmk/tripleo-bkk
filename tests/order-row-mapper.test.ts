import { describe, expect, it } from "vitest";
import type { ConfirmedOrder } from "@/lib/orders";
import {
  mapOrderToSheetRows,
  orderItemsHeaders,
  ordersHeaders
} from "@/lib/server/order-row-mapper";

const order: ConfirmedOrder = {
  orderId: "KG-2026-A8F2B91C",
  createdAtIso: "2026-08-29T10:00:00.000Z",
  universityId: "bangmod",
  checkout: {
    fullName: "Ada Lovelace",
    phone: "0812345678",
    deliveryMethod: "shipping",
    shippingAddress: "123 Test Road"
  },
  items: [
    {
      lineId: "bangmod:kg-bm-matcha:M",
      productId: "kg-bm-matcha",
      universityId: "bangmod",
      productName: "Matcha Shirt",
      colorName: "Matcha",
      size: "M",
      quantity: 2,
      unitPriceThb: 390,
      image: "/products/jersey-matcha.svg"
    },
    {
      lineId: "bangmod:kg-bm-mint-chocolate:L",
      productId: "kg-bm-mint-chocolate",
      universityId: "bangmod",
      productName: "Mint Chocolate Chip Shirt",
      colorName: "Mint Chocolate Chip",
      size: "L",
      quantity: 1,
      unitPriceThb: 420,
      image: "/products/jersey-mint-chocolate.svg"
    }
  ],
  itemSubtotalThb: 1200,
  shippingFeeThb: 50,
  finalTotalThb: 1250,
  paymentStatus: "pending",
  slipSelected: true
};

describe("Google Sheet row mapping", () => {
  it("matches the workbook header widths", () => {
    const rows = mapOrderToSheetRows(order);

    expect(rows.ordersRow).toHaveLength(ordersHeaders.length);
    rows.orderItemsRows.forEach((row) => {
      expect(row).toHaveLength(orderItemsHeaders.length);
    });
  });

  it("maps one order to one Orders row", () => {
    const rows = mapOrderToSheetRows(order);

    expect(rows.ordersRow[0]).toBe(order.orderId);
    expect(rows.ordersRow[2]).toBe("BANGMOD");
    expect(rows.ordersRow[5]).toBe("SHIPPING");
    expect(rows.ordersRow[10]).toBe("PENDING");
    expect(rows.ordersRow[11]).toBe("");
    expect(rows.ordersRow[12]).toBe("");
    expect(rows.ordersRow[13]).toBe("NEW");
  });

  it("maps the private Drive file ID into SLIP_FILE_ID", () => {
    const rows = mapOrderToSheetRows({
      ...order,
      slipFileId: "drive-file-123"
    });

    expect(rows.ordersRow[11]).toBe("drive-file-123");
    expect(rows.ordersRow[12]).toBe("");
  });

  it("maps multiple cart items to multiple OrderItems rows", () => {
    const rows = mapOrderToSheetRows(order);

    expect(rows.orderItemsRows).toHaveLength(2);
    expect(rows.orderItemsRows.every((row) => row[0] === order.orderId)).toBe(true);
    expect(rows.orderItemsRows[0]).toEqual([
      order.orderId,
      "KG-2026-A8F2B91C-01",
      "kg-bm-matcha",
      "Matcha",
      "M",
      2,
      390,
      780
    ]);
  });
});
