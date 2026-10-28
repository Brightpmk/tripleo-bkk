import { describe, expect, it } from "vitest";
import {
  buildSalesSummary, defaultSalesFilters, validateSalesFilters,
  type SalesOrder, type SalesItem, type SalesProduct
} from "@/lib/sales-summary";

function order(orderId: string, patch: Partial<SalesOrder> = {}): SalesOrder {
  return {
    orderId, university: "BANGMOD", createdAt: "2026-10-27T10:00:00Z",
    paymentStatus: "verified", orderStatus: "new", ...patch
  };
}

function item(orderId: string, patch: Partial<SalesItem> = {}): SalesItem {
  return { orderId, productId: "bm-white", shirtColor: "White", size: "M", quantity: 2, lineTotalThb: 500, ...patch };
}

const product: SalesProduct = {
  productId: "bm-white", university: "BANGMOD", shirtColor: "White",
  imageUrl: "/products/white.jpg", availableSizes: ["S", "M", "L"], active: true, sortOrder: 1
};

describe("shirt sales summary", () => {
  it("sums quantities per size and distinct design, counts an order once, and uses historical revenue", () => {
    const result = buildSalesSummary({
      orders: [order("one"), order("two")],
      items: [item("one"), item("one", { size: "L", quantity: 3, lineTotalThb: 810 }),
        item("two", { quantity: 1, lineTotalThb: 260 }),
        item("one", { productId: "wbm-white", quantity: 4, lineTotalThb: 1000 })],
      products: [product, { ...product, productId: "wbm-white" }]
    });
    expect(result.orderCount).toBe(2);
    expect(result.units).toBe(10);
    expect(result.revenueThb).toBe(2570);
    expect(result.groups[0].orderCount).toBe(2);
    expect(result.groups[0].products).toHaveLength(2);
    expect(result.groups[0].products[0]).toMatchObject({ productId: "bm-white", units: 6, revenueThb: 1570, quantities: { M: 3, L: 3 } });
    expect(result.groups[0].products[1]).toMatchObject({ productId: "wbm-white", units: 4 });
    expect(result.groups[0].quantities).toEqual({ M: 7, L: 3 });
  });

  it("defaults to paid orders and always excludes cancellations and rejected payments", () => {
    const orders = [order("paid"), order("pending", { paymentStatus: "pending" }),
      order("review", { paymentStatus: "review_required" }), order("rejected", { paymentStatus: "rejected" }),
      order("cancelled", { orderStatus: "cancelled" })];
    const source = { orders, items: [...orders.map((entry) => item(entry.orderId)), item("orphan")], products: [product] };
    expect(buildSalesSummary(source).units).toBe(2);
    const all = buildSalesSummary(source, { ...defaultSalesFilters, payment: "all" });
    expect(all.units).toBe(6);
    expect(all.orderCount).toBe(3);
    expect(buildSalesSummary(source, { ...defaultSalesFilters, payment: "pending" }).units).toBe(2);
  });

  it("groups sales under the order's university and retains deleted designs", () => {
    const result = buildSalesSummary({
      orders: [order("bm"), order("msu", { university: "MAHASARAKHAM" })],
      items: [item("bm", { productId: "deleted-white", size: "5XL" }), item("msu")], products: [product]
    });
    const bm = result.groups.find((group) => group.university === "BANGMOD")!;
    const msu = result.groups.find((group) => group.university === "MAHASARAKHAM")!;
    expect(bm.products.find((entry) => entry.productId === "deleted-white")).toMatchObject({ historical: true, units: 2, quantities: { "5XL": 2 } });
    expect(bm.products.find((entry) => entry.productId === "bm-white")!.units).toBe(0);
    expect(msu.products[0]).toMatchObject({ productId: "bm-white", units: 2, historical: true });
    expect(result.units).toBe(4);
  });

  it("includes both ends of a Bangkok calendar date and excludes neighboring UTC dates", () => {
    const orders = [
      order("before", { createdAt: "2026-10-26T16:59:59.999Z" }),
      order("start", { createdAt: "2026-10-26T17:00:00.000Z" }),
      order("end", { createdAt: "2026-10-27T16:59:59.999Z" }),
      order("after", { createdAt: "2026-10-27T17:00:00.000Z" })
    ];
    const result = buildSalesSummary({ orders, items: orders.map((entry) => item(entry.orderId)), products: [product] },
      { ...defaultSalesFilters, from: "2026-10-27", to: "2026-10-27" });
    expect(result.orderCount).toBe(2);
    expect(result.units).toBe(4);
  });

  it("keeps unsold and inactive catalog designs at zero and preserves additional historical sizes", () => {
    const empty = buildSalesSummary({ orders: [], items: [], products: [{ ...product, active: false }] });
    expect(empty.groups[0].products[0]).toMatchObject({ units: 0, active: false, quantities: {} });
    const source = { orders: [order("one")], items: [item("one", { size: "6XL" })], products: [product] };
    const result = buildSalesSummary(source);
    expect(result.sizes).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]);
    expect(result.groups[0].quantities["6XL"]).toBe(2);
    expect(buildSalesSummary(source, { ...defaultSalesFilters, university: "MAHASARAKHAM" }).groups).toEqual([]);
  });

  it("rejects impossible and reversed dates and unsupported filters", () => {
    expect(validateSalesFilters({ ...defaultSalesFilters, from: "2026-02-30" })).toBeTruthy();
    expect(validateSalesFilters({ ...defaultSalesFilters, from: "2026-11-01", to: "2026-10-01" })).toBeTruthy();
    expect(validateSalesFilters({ ...defaultSalesFilters, university: "unknown" })).toBeTruthy();
    expect(validateSalesFilters({ ...defaultSalesFilters, from: "2028-02-29" })).toBeNull();
    expect(validateSalesFilters(defaultSalesFilters)).toBeNull();
  });
});
