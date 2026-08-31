import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmedOrder } from "@/lib/orders";

vi.mock("server-only", () => ({}));

const getSupabaseServiceClient = vi.fn();

vi.mock("@/lib/server/supabase/client", () => ({
  getSupabaseServiceClient
}));

function thenableQuery<T>(response: T) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(async () => response),
    then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject)
  };

  return query;
}

beforeEach(() => {
  getSupabaseServiceClient.mockReset();
});

describe("Supabase product runtime", () => {
  it("loads active storefront products with the existing catalog shape", async () => {
    const productsQuery = thenableQuery({
      data: [
        {
          product_id: "kg-bm-blue",
          university: "BANGMOD",
          shirt_color: "Blue",
          base_price_thb: 299,
          image_url: "",
          available_sizes: ["S", "M", "3XL", "4XL", "5XL"],
          active: true,
          sort_order: 1
        }
      ],
      error: null
    });
    getSupabaseServiceClient.mockReturnValue({
      from: vi.fn(() => productsQuery)
    });

    const { listActiveSupabaseCatalog } = await import(
      "@/lib/server/supabase/product-repository"
    );
    const products = await listActiveSupabaseCatalog();

    expect(productsQuery.eq).toHaveBeenCalledWith("active", true);
    expect(products[0]).toMatchObject({
      id: "kg-bm-blue",
      primaryUniversityId: "bangmod",
      colorName: "Blue",
      priceThb: 299,
      image: "/products/product-placeholder.svg",
      availableSizes: ["S", "M", "3XL", "4XL", "5XL"],
      active: true,
      sortOrder: 1
    });
  });

  it("deletes products without touching historical order item rows", async () => {
    const deleteQuery = {
      delete: vi.fn(() => deleteQuery),
      eq: vi.fn(() => deleteQuery),
      select: vi.fn(() => deleteQuery),
      maybeSingle: vi.fn(async () => ({
        data: { product_id: "kg-bm-blue" },
        error: null
      }))
    };
    const from = vi.fn(() => deleteQuery);
    getSupabaseServiceClient.mockReturnValue({ from });

    const { deleteSupabaseProduct } = await import(
      "@/lib/server/supabase/product-repository"
    );
    await deleteSupabaseProduct("kg-bm-blue");

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("products");
  });
});

describe("Supabase checkout runtime", () => {
  it("persists orders through one transaction RPC with historical item snapshots", async () => {
    const rpc = vi.fn(async () => ({ data: { order_id: "KG-2026-1234ABCD" }, error: null }));
    getSupabaseServiceClient.mockReturnValue({ rpc });

    const order: ConfirmedOrder = {
      orderId: "KG-2026-1234ABCD",
      createdAtIso: "2026-08-31T10:00:00.000Z",
      universityId: "bangmod",
      checkout: {
        fullName: "Ada Lovelace",
        phone: "0812345678",
        deliveryMethod: "shipping",
        shippingAddress: "123 Test Road"
      },
      items: [
        {
          lineId: "line-1",
          productId: "kg-bm-blue",
          universityId: "bangmod",
          productName: "Blue Shirt",
          colorName: "Blue",
          size: "3XL",
          quantity: 2,
          basePriceThb: 299,
          sizeSurchargeThb: 15,
          unitPriceThb: 314,
          image: "/products/product-placeholder.svg"
        }
      ],
      itemSubtotalThb: 628,
      shippingFeeThb: 50,
      finalTotalThb: 678,
      paymentStatus: "pending",
      slipSelected: true,
      slipFileId: "drive-file-id"
    };

    const { createSupabaseOrderWithItems } = await import(
      "@/lib/server/supabase/order-repository"
    );
    await createSupabaseOrderWithItems(order);

    expect(rpc).toHaveBeenCalledWith("create_order_with_items", {
      p_order: expect.objectContaining({
        order_id: "KG-2026-1234ABCD",
        university: "BANGMOD",
        payment_status: "pending",
        slip_file_id: "drive-file-id"
      }),
      p_items: [
        expect.objectContaining({
          item_id: "KG-2026-1234ABCD-01",
          product_id: "kg-bm-blue",
          shirt_color: "Blue",
          size: "3XL",
          quantity: 2,
          unit_price_thb: 314,
          line_total_thb: 628
        })
      ]
    });
  });
});

describe("Supabase tracking runtime", () => {
  it("uses normalized indexed columns and batches item loading", async () => {
    const ordersQuery = thenableQuery({
      data: [
        {
          order_id: "KG-2026-1234ABCD",
          created_at: "2026-08-31T10:00:00.000Z",
          full_name: "Ada Lovelace",
          phone: "0812345678",
          university: "BANGMOD",
          delivery_method: "shipping",
          shipping_address: "123 Test Road",
          shipping_fee_thb: 50,
          subtotal_thb: 628,
          total_thb: 678,
          payment_status: "verified",
          slip_file_id: "drive-file-id",
          order_status: "shipped",
          shipping_provider: "EMS",
          tracking_number: "TH123",
          notes: "private"
        }
      ],
      error: null
    });
    const itemsQuery = thenableQuery({
      data: [
        {
          order_id: "KG-2026-1234ABCD",
          item_id: "KG-2026-1234ABCD-01",
          product_id: "kg-bm-blue",
          shirt_color: "Blue",
          size: "M",
          quantity: 1,
          unit_price_thb: 299,
          line_total_thb: 299
        }
      ],
      error: null
    });
    const from = vi.fn((table: string) =>
      table === "orders" ? ordersQuery : itemsQuery
    );
    getSupabaseServiceClient.mockReturnValue({ from });

    const { searchSupabaseTrackingOrders } = await import(
      "@/lib/server/supabase/order-repository"
    );
    const orders = await searchSupabaseTrackingOrders("phone", "0812345678");

    expect(ordersQuery.eq).toHaveBeenCalledWith("phone_search", "0812345678");
    expect(itemsQuery.in).toHaveBeenCalledWith("order_id", ["KG-2026-1234ABCD"]);
    expect(orders[0]).toMatchObject({
      orderId: "KG-2026-1234ABCD",
      paymentStatus: "verified",
      orderStatus: "shipped",
      shippingProvider: "EMS",
      trackingNumber: "TH123"
    });
  });
});
