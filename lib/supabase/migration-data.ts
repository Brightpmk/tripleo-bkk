import {
  adminProductSizes,
  adminUniversities,
  type AdminUniversity
} from "../admin-products";
import {
  parseDeliveryMethod,
  parseOrderStatus,
  parsePaymentStatus
} from "../orders-admin";

export const productSourceHeaders = [
  "PRODUCT_ID",
  "UNIVERSITY",
  "SHIRT_COLOR",
  "PRICE",
  "IMAGE_URL",
  "AVAILABLE_SIZES",
  "ACTIVE",
  "SORT_ORDER"
] as const;

export const orderSourceHeaders = [
  "ORDER_ID",
  "CREATED_AT",
  "UNIVERSITY",
  "FULL_NAME",
  "PHONE",
  "DELIVERY_METHOD",
  "SHIPPING_ADDRESS",
  "SHIPPING_FEE",
  "SUBTOTAL",
  "TOTAL",
  "PAYMENT_STATUS",
  "SLIP_FILE_ID",
  "SLIP_URL",
  "ORDER_STATUS",
  "SHIPPING_PROVIDER",
  "TRACKING_NUMBER",
  "NOTES"
] as const;

export const orderItemSourceHeaders = [
  "ORDER_ID",
  "ITEM_ID",
  "PRODUCT_ID",
  "SHIRT_COLOR",
  "SIZE",
  "QUANTITY",
  "UNIT_PRICE",
  "LINE_TOTAL"
] as const;

export type SheetRows = {
  productRows: unknown[][];
  orderRows: unknown[][];
  orderItemRows: unknown[][];
};

export type SupabaseProductInsert = {
  product_id: string;
  university: AdminUniversity;
  shirt_color: string;
  base_price_thb: number;
  image_url: string | null;
  available_sizes: string[];
  active: boolean;
  sort_order: number;
};

export type SupabaseOrderInsert = {
  order_id: string;
  created_at: string;
  full_name: string;
  phone: string;
  university: AdminUniversity;
  delivery_method: "pickup" | "shipping";
  shipping_address: string | null;
  shipping_fee_thb: number;
  subtotal_thb: number;
  total_thb: number;
  payment_status: "pending" | "verified" | "review_required" | "rejected";
  slip_file_id: string | null;
  order_status: "new" | "preparing" | "shipped" | "completed" | "cancelled";
  shipping_provider: string | null;
  tracking_number: string | null;
  notes: string | null;
};

export type SupabaseOrderItemInsert = {
  order_id: string;
  item_id: string;
  product_id: string;
  shirt_color: string;
  size: string;
  quantity: number;
  unit_price_thb: number;
  line_total_thb: number;
};

export type MigrationIssue = {
  sheet: "Products" | "Orders" | "OrderItems";
  rowNumber: number;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type MigrationReport = {
  sourceFields: {
    products: string[];
    orders: string[];
    orderItems: string[];
  };
  counts: {
    products: number;
    orders: number;
    orderItems: number;
  };
  skippedBlankRows: {
    products: number;
    orders: number;
    orderItems: number;
  };
  issues: MigrationIssue[];
};

export type NormalizedMigrationData = {
  products: SupabaseProductInsert[];
  orders: SupabaseOrderInsert[];
  orderItems: SupabaseOrderItemInsert[];
  report: MigrationReport;
};

const productIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const itemIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/;

export function normalizeSheetsForSupabase(rows: SheetRows): NormalizedMigrationData {
  const issues: MigrationIssue[] = [];
  const products = normalizeProducts(rows.productRows, issues);
  const orders = normalizeOrders(rows.orderRows, issues);
  const orderItems = normalizeOrderItems(rows.orderItemRows, orders, products, issues);

  detectDuplicates("Products", products, "product_id", "duplicate_product_id", issues);
  detectDuplicates("Orders", orders, "order_id", "duplicate_order_id", issues);
  detectDuplicates("OrderItems", orderItems, "item_id", "duplicate_item_id", issues);

  return {
    products,
    orders,
    orderItems,
    report: {
      sourceFields: {
        products: [...productSourceHeaders],
        orders: [...orderSourceHeaders],
        orderItems: [...orderItemSourceHeaders]
      },
      counts: {
        products: products.length,
        orders: orders.length,
        orderItems: orderItems.length
      },
      skippedBlankRows: {
        products: countBlankDataRows(rows.productRows),
        orders: countBlankDataRows(rows.orderRows),
        orderItems: countBlankDataRows(rows.orderItemRows)
      },
      issues
    }
  };
}

export function hasBlockingMigrationIssues(report: MigrationReport) {
  return report.issues.some((issue) => issue.severity === "error");
}

function normalizeProducts(
  rows: unknown[][],
  issues: MigrationIssue[]
): SupabaseProductInsert[] {
  const headers = getHeaderMap(rows, productSourceHeaders, "Products", issues);
  if (!headers) return [];

  return rows.slice(1).flatMap((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) return [];

    const productId = cell(row[headers.PRODUCT_ID]);
    const university = cell(row[headers.UNIVERSITY]).toUpperCase();
    const shirtColor = cell(row[headers.SHIRT_COLOR]);
    const basePriceThb = parseWholeBaht(row[headers.PRICE]);
    const imageUrl = cell(row[headers.IMAGE_URL]);
    const availableSizes = parseSizes(row[headers.AVAILABLE_SIZES]);
    const active = parseBoolean(row[headers.ACTIVE]);
    const sortOrder = parseInteger(row[headers.SORT_ORDER]);

    if (!productIdPattern.test(productId)) {
      addIssue(issues, "Products", rowNumber, "invalid_product_id", "PRODUCT_ID is missing or invalid.");
    }

    if (!adminUniversities.includes(university as AdminUniversity)) {
      addIssue(issues, "Products", rowNumber, "unknown_university", `Unknown UNIVERSITY: ${university || "(blank)"}.`);
    }

    if (!shirtColor) {
      addIssue(issues, "Products", rowNumber, "missing_shirt_color", "SHIRT_COLOR is required.");
    }

    if (basePriceThb === null || basePriceThb <= 0) {
      addIssue(issues, "Products", rowNumber, "invalid_price", "PRICE must be a positive whole THB value.");
    }

    if (availableSizes.length === 0) {
      addIssue(issues, "Products", rowNumber, "invalid_sizes", "AVAILABLE_SIZES must contain at least one supported size.");
    }

    if (active === null) {
      addIssue(issues, "Products", rowNumber, "invalid_active", "ACTIVE must be TRUE or FALSE.");
    }

    if (sortOrder === null || sortOrder < 0) {
      addIssue(issues, "Products", rowNumber, "invalid_sort_order", "SORT_ORDER must be a non-negative whole number.");
    }

    if (
      !productIdPattern.test(productId) ||
      !adminUniversities.includes(university as AdminUniversity) ||
      !shirtColor ||
      basePriceThb === null ||
      basePriceThb <= 0 ||
      availableSizes.length === 0 ||
      active === null ||
      sortOrder === null ||
      sortOrder < 0
    ) {
      return [];
    }

    return [
      {
        product_id: productId,
        university: university as AdminUniversity,
        shirt_color: shirtColor,
        base_price_thb: basePriceThb,
        image_url: imageUrl || null,
        available_sizes: availableSizes,
        active,
        sort_order: sortOrder
      }
    ];
  });
}

function normalizeOrders(
  rows: unknown[][],
  issues: MigrationIssue[]
): SupabaseOrderInsert[] {
  const headers = getHeaderMap(rows, orderSourceHeaders, "Orders", issues);
  if (!headers) return [];

  return rows.slice(1).flatMap((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) return [];

    const orderId = cell(row[headers.ORDER_ID]);
    const createdAt = parseTimestamp(row[headers.CREATED_AT]);
    const university = cell(row[headers.UNIVERSITY]).toUpperCase();
    const fullName = cell(row[headers.FULL_NAME]);
    const phone = cell(row[headers.PHONE]);
    const deliveryMethod = parseDeliveryMethod(cell(row[headers.DELIVERY_METHOD]));
    const shippingAddress = cell(row[headers.SHIPPING_ADDRESS]);
    const shippingFeeThb = parseWholeBaht(row[headers.SHIPPING_FEE]);
    const subtotalThb = parseWholeBaht(row[headers.SUBTOTAL]);
    const totalThb = parseWholeBaht(row[headers.TOTAL]);
    const paymentStatus = parsePaymentStatus(row[headers.PAYMENT_STATUS]);
    const orderStatus = parseOrderStatus(row[headers.ORDER_STATUS]);
    const slipFileId = cell(row[headers.SLIP_FILE_ID]);
    const shippingProvider = cell(row[headers.SHIPPING_PROVIDER]);
    const trackingNumber = cell(row[headers.TRACKING_NUMBER]);
    const notes = cell(row[headers.NOTES]);

    if (!productIdPattern.test(orderId)) {
      addIssue(issues, "Orders", rowNumber, "invalid_order_id", "ORDER_ID is missing or invalid.");
    }

    if (!createdAt) {
      addIssue(issues, "Orders", rowNumber, "malformed_timestamp", "CREATED_AT is missing or unreadable.");
    }

    if (!adminUniversities.includes(university as AdminUniversity)) {
      addIssue(issues, "Orders", rowNumber, "unknown_university", `Unknown UNIVERSITY: ${university || "(blank)"}.`);
    }

    if (!fullName) {
      addIssue(issues, "Orders", rowNumber, "missing_full_name", "FULL_NAME is required.");
    }

    if (!phone) {
      addIssue(issues, "Orders", rowNumber, "missing_phone", "PHONE is required and must remain text.");
    }

    if (!deliveryMethod) {
      addIssue(issues, "Orders", rowNumber, "invalid_delivery_method", "DELIVERY_METHOD must be PICKUP or SHIPPING.");
    }

    if (deliveryMethod === "shipping" && !shippingAddress) {
      addIssue(issues, "Orders", rowNumber, "missing_shipping_address", "SHIPPING orders require SHIPPING_ADDRESS.");
    }

    for (const [code, label, value] of [
      ["invalid_shipping_fee", "SHIPPING_FEE", shippingFeeThb],
      ["invalid_subtotal", "SUBTOTAL", subtotalThb],
      ["invalid_total", "TOTAL", totalThb]
    ] as const) {
      if (value === null || value < 0) {
        addIssue(issues, "Orders", rowNumber, code, `${label} must be a non-negative whole THB value.`);
      }
    }

    if (!paymentStatus) {
      addIssue(issues, "Orders", rowNumber, "malformed_payment_status", "PAYMENT_STATUS is not supported.");
    }

    if (!orderStatus) {
      addIssue(issues, "Orders", rowNumber, "malformed_order_status", "ORDER_STATUS is not supported.");
    }

    if (
      !productIdPattern.test(orderId) ||
      !createdAt ||
      !adminUniversities.includes(university as AdminUniversity) ||
      !fullName ||
      !phone ||
      !deliveryMethod ||
      (deliveryMethod === "shipping" && !shippingAddress) ||
      shippingFeeThb === null ||
      shippingFeeThb < 0 ||
      subtotalThb === null ||
      subtotalThb < 0 ||
      totalThb === null ||
      totalThb < 0 ||
      !paymentStatus ||
      !orderStatus
    ) {
      return [];
    }

    return [
      {
        order_id: orderId,
        created_at: createdAt,
        full_name: fullName,
        phone,
        university: university as AdminUniversity,
        delivery_method: deliveryMethod,
        shipping_address: shippingAddress || null,
        shipping_fee_thb: shippingFeeThb,
        subtotal_thb: subtotalThb,
        total_thb: totalThb,
        payment_status: paymentStatus,
        slip_file_id: slipFileId || null,
        order_status: orderStatus,
        shipping_provider: shippingProvider || null,
        tracking_number: trackingNumber || null,
        notes: notes || null
      }
    ];
  });
}

function normalizeOrderItems(
  rows: unknown[][],
  orders: SupabaseOrderInsert[],
  products: SupabaseProductInsert[],
  issues: MigrationIssue[]
): SupabaseOrderItemInsert[] {
  const headers = getHeaderMap(rows, orderItemSourceHeaders, "OrderItems", issues);
  if (!headers) return [];

  const orderIds = new Set(orders.map((order) => order.order_id));
  const productIds = new Set(products.map((product) => product.product_id));

  return rows.slice(1).flatMap((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) return [];

    const orderId = cell(row[headers.ORDER_ID]);
    const itemId = cell(row[headers.ITEM_ID]);
    const productId = cell(row[headers.PRODUCT_ID]);
    const shirtColor = cell(row[headers.SHIRT_COLOR]);
    const size = cell(row[headers.SIZE]).toUpperCase();
    const quantity = parseInteger(row[headers.QUANTITY]);
    const unitPriceThb = parseWholeBaht(row[headers.UNIT_PRICE]);
    const lineTotalThb = parseWholeBaht(row[headers.LINE_TOTAL]);

    if (!orderIds.has(orderId)) {
      addIssue(issues, "OrderItems", rowNumber, "orphan_order_item", `ORDER_ID has no matching Orders row: ${orderId || "(blank)"}.`);
    }

    if (!itemIdPattern.test(itemId)) {
      addIssue(issues, "OrderItems", rowNumber, "invalid_item_id", "ITEM_ID is missing or invalid.");
    }

    if (!productId) {
      addIssue(issues, "OrderItems", rowNumber, "missing_product_id", "PRODUCT_ID is required.");
    } else if (!productIds.has(productId)) {
      addIssue(
        issues,
        "OrderItems",
        rowNumber,
        "unknown_product_id",
        `PRODUCT_ID has no matching current Products row: ${productId}. Historical item snapshot will still be imported.`,
        "warning"
      );
    }

    if (!shirtColor) {
      addIssue(issues, "OrderItems", rowNumber, "missing_shirt_color", "SHIRT_COLOR is required.");
    }

    if (!adminProductSizes.includes(size as never)) {
      addIssue(issues, "OrderItems", rowNumber, "unknown_size", `Unknown SIZE: ${size || "(blank)"}.`);
    }

    if (quantity === null || quantity <= 0) {
      addIssue(issues, "OrderItems", rowNumber, "invalid_quantity", "QUANTITY must be positive.");
    }

    if (unitPriceThb === null || unitPriceThb <= 0) {
      addIssue(issues, "OrderItems", rowNumber, "invalid_unit_price", "UNIT_PRICE must be a positive whole THB value.");
    }

    if (lineTotalThb === null || lineTotalThb < 0) {
      addIssue(issues, "OrderItems", rowNumber, "invalid_line_total", "LINE_TOTAL must be a non-negative whole THB value.");
    }

    if (
      !orderIds.has(orderId) ||
      !itemIdPattern.test(itemId) ||
      !productId ||
      !shirtColor ||
      !adminProductSizes.includes(size as never) ||
      quantity === null ||
      quantity <= 0 ||
      unitPriceThb === null ||
      unitPriceThb <= 0 ||
      lineTotalThb === null ||
      lineTotalThb < 0
    ) {
      return [];
    }

    return [
      {
        order_id: orderId,
        item_id: itemId,
        product_id: productId,
        shirt_color: shirtColor,
        size,
        quantity,
        unit_price_thb: unitPriceThb,
        line_total_thb: lineTotalThb
      }
    ];
  });
}

function detectDuplicates<T extends Record<string, unknown>>(
  sheet: MigrationIssue["sheet"],
  rows: T[],
  key: keyof T,
  code: string,
  issues: MigrationIssue[]
) {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const value = String(row[key] ?? "");
    if (!value) continue;
    if (seen.has(value)) {
      addIssue(issues, sheet, index + 2, code, `Duplicate ${String(key)}: ${value}.`);
    }
    seen.add(value);
  }
}

function getHeaderMap<const T extends readonly string[]>(
  rows: unknown[][],
  requiredHeaders: T,
  sheet: MigrationIssue["sheet"],
  issues: MigrationIssue[]
): Record<T[number], number> | null {
  const headerRow = rows[0] ?? [];
  const normalized = headerRow.map((value) => normalizeHeader(cell(value)));
  const missing = requiredHeaders.filter(
    (header) => !normalized.includes(normalizeHeader(header))
  );

  if (missing.length > 0) {
    addIssue(
      issues,
      sheet,
      1,
      "missing_headers",
      `Missing headers: ${missing.join(", ")}.`
    );
    return null;
  }

  return Object.fromEntries(
    requiredHeaders.map((header) => [
      header,
      normalized.indexOf(normalizeHeader(header))
    ])
  ) as Record<T[number], number>;
}

function parseSizes(value: unknown) {
  const seen = new Set<string>();
  return cell(value)
    .split(",")
    .map((size) => size.trim().toUpperCase())
    .filter((size) => {
      if (!size || seen.has(size) || !adminProductSizes.includes(size as never)) {
        return false;
      }
      seen.add(size);
      return true;
    });
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;

  switch (cell(value).toLowerCase()) {
    case "true":
    case "yes":
    case "1":
      return true;
    case "false":
    case "no":
    case "0":
      return false;
    default:
      return null;
  }
}

function parseInteger(value: unknown) {
  const number = parseNumber(value);
  if (number === null || !Number.isInteger(number)) return null;
  return number;
}

function parseWholeBaht(value: unknown) {
  const number = parseNumber(value);
  if (number === null || !Number.isInteger(number)) return null;
  return number;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = cell(value).replace(/[^0-9.-]+/g, "");
  if (!normalized) return null;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const raw = cell(value);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function countBlankDataRows(rows: unknown[][]) {
  return rows.slice(1).filter(isBlankRow).length;
}

function isBlankRow(row: unknown[]) {
  return row.every((value) => cell(value) === "");
}

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function cell(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function addIssue(
  issues: MigrationIssue[],
  sheet: MigrationIssue["sheet"],
  rowNumber: number,
  code: string,
  message: string,
  severity: MigrationIssue["severity"] = "error"
) {
  issues.push({ sheet, rowNumber, severity, code, message });
}
