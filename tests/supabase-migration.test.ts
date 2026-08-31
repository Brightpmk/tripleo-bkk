import { describe, expect, it } from "vitest";
import {
  hasBlockingMigrationIssues,
  normalizeSheetsForSupabase,
  orderItemSourceHeaders,
  orderSourceHeaders,
  productSourceHeaders
} from "@/lib/supabase/migration-data";

describe("Supabase migration data normalization", () => {
  it("normalizes the current Google Sheets fields into Supabase rows", () => {
    const data = normalizeSheetsForSupabase({
      productRows: [
        [...productSourceHeaders],
        [
          "shirt-blue",
          "BANGMOD",
          "Blue",
          "฿299",
          "",
          "XS,S,M,L,XL,2XL,3XL,4XL,5XL",
          "TRUE",
          "0"
        ]
      ],
      orderRows: [
        [...orderSourceHeaders],
        [
          "KG-2026-1234ABCD",
          "2026-08-30T14:17:33.120Z",
          "BANGMOD",
          "Bright",
          "0955084969",
          "SHIPPING",
          "Bangkok",
          "฿50",
          "฿299",
          "฿349",
          "PAID",
          "drive-file-id",
          "",
          "PACKING",
          "EMS",
          "TH123",
          ""
        ]
      ],
      orderItemRows: [
        [...orderItemSourceHeaders],
        [
          "KG-2026-1234ABCD",
          "KG-2026-1234ABCD-01",
          "shirt-blue",
          "Blue",
          "3XL",
          "1",
          "฿314",
          "฿314"
        ]
      ]
    });

    expect(hasBlockingMigrationIssues(data.report)).toBe(false);
    expect(data.products[0]).toMatchObject({
      product_id: "shirt-blue",
      university: "BANGMOD",
      base_price_thb: 299,
      image_url: null,
      available_sizes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]
    });
    expect(data.orders[0]).toMatchObject({
      phone: "0955084969",
      delivery_method: "shipping",
      payment_status: "verified",
      order_status: "preparing",
      slip_file_id: "drive-file-id"
    });
    expect(data.orderItems[0]).toMatchObject({
      size: "3XL",
      quantity: 1,
      unit_price_thb: 314
    });
  });

  it("reports duplicate IDs and invalid item references before import", () => {
    const data = normalizeSheetsForSupabase({
      productRows: [
        [...productSourceHeaders],
        ["shirt-blue", "BANGMOD", "Blue", 299, "", "S,M,L", true, 0],
        ["shirt-blue", "BANGMOD", "Blue duplicate", 299, "", "S,M,L", true, 1]
      ],
      orderRows: [
        [...orderSourceHeaders],
        [
          "KG-2026-1234ABCD",
          "2026-08-30T14:17:33.120Z",
          "BANGMOD",
          "Bright",
          "0955084969",
          "PICKUP",
          "",
          0,
          299,
          299,
          "PENDING",
          "",
          "",
          "NEW",
          "",
          "",
          ""
        ],
        [
          "KG-2026-1234ABCD",
          "2026-08-30T14:17:33.120Z",
          "BANGMOD",
          "Bright",
          "0955084969",
          "PICKUP",
          "",
          0,
          299,
          299,
          "PENDING",
          "",
          "",
          "NEW",
          "",
          "",
          ""
        ]
      ],
      orderItemRows: [
        [...orderItemSourceHeaders],
        [
          "KG-2026-MISSING",
          "KG-2026-MISSING-01",
          "missing-product",
          "Blue",
          "6XL",
          0,
          299,
          0
        ]
      ]
    });

    expect(data.report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_product_id",
        "duplicate_order_id",
        "orphan_order_item",
        "unknown_product_id",
        "unknown_size",
        "invalid_quantity"
      ])
    );
    expect(hasBlockingMigrationIssues(data.report)).toBe(true);
  });

  it("allows historical order items whose products are no longer in the catalog", () => {
    const data = normalizeSheetsForSupabase({
      productRows: [
        [...productSourceHeaders],
        ["shirt-blue", "BANGMOD", "Blue", 299, "", "S,M,L", true, 0]
      ],
      orderRows: [
        [...orderSourceHeaders],
        [
          "KG-2026-1234ABCD",
          "2026-08-30T14:17:33.120Z",
          "BANGMOD",
          "Bright",
          "0955084969",
          "PICKUP",
          "",
          0,
          299,
          299,
          "PENDING",
          "",
          "",
          "NEW",
          "",
          "",
          ""
        ]
      ],
      orderItemRows: [
        [...orderItemSourceHeaders],
        [
          "KG-2026-1234ABCD",
          "KG-2026-1234ABCD-01",
          "old-product",
          "Legacy color",
          "M",
          1,
          299,
          299
        ]
      ]
    });

    expect(data.orderItems).toHaveLength(1);
    expect(data.report.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "unknown_product_id"
      })
    ]);
    expect(hasBlockingMigrationIssues(data.report)).toBe(false);
  });
});
