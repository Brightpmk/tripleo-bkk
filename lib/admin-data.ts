export type DataCell = string | number | boolean | null;
export type DataRow = Record<string, DataCell>;
export type DataColumn = {
  key: string;
  label: string;
  kind?: "number" | "date" | "boolean";
  width?: number;
};

export const dataTableIds = ["orders", "order_items", "products", "product_images"] as const;
export type DataTableId = (typeof dataTableIds)[number];

const createdAt: DataColumn = { key: "created_at", label: "Created at (UTC)", kind: "date", width: 23 };
const updatedAt: DataColumn = { key: "updated_at", label: "Updated at (UTC)", kind: "date", width: 23 };
const recordId: DataColumn = { key: "id", label: "Record ID", width: 38 };

export const dataTables: Record<DataTableId, { label: string; columns: DataColumn[] }> = {
  orders: {
    label: "Orders",
    columns: [
      { key: "order_id", label: "Order ID", width: 24 },
      createdAt,
      { key: "full_name", label: "Full name", width: 28 },
      { key: "phone", label: "Phone", width: 18 },
      { key: "university", label: "University", width: 24 },
      { key: "delivery_method", label: "Delivery method" },
      { key: "shipping_address", label: "Shipping address", width: 48 },
      { key: "subtotal_thb", label: "Subtotal (THB)", kind: "number" },
      { key: "shipping_fee_thb", label: "Shipping fee (THB)", kind: "number", width: 22 },
      { key: "total_thb", label: "Total (THB)", kind: "number" },
      { key: "payment_status", label: "Payment status", width: 22 },
      { key: "slip_uploaded", label: "Slip uploaded", kind: "boolean" },
      { key: "order_status", label: "Order status" },
      { key: "shipping_provider", label: "Shipping provider", width: 24 },
      { key: "tracking_number", label: "Tracking number", width: 26 },
      { key: "notes", label: "Notes", width: 48 },
      updatedAt, recordId
    ]
  },
  order_items: {
    label: "Order Items",
    columns: [
      { key: "item_id", label: "Item ID", width: 30 },
      { key: "order_id", label: "Order ID", width: 24 },
      { key: "product_id", label: "Product ID", width: 24 },
      { key: "shirt_color", label: "Shirt color", width: 22 },
      { key: "size", label: "Size", width: 12 },
      { key: "quantity", label: "Quantity", kind: "number", width: 12 },
      { key: "unit_price_thb", label: "Unit price (THB)", kind: "number", width: 22 },
      { key: "line_total_thb", label: "Line total (THB)", kind: "number", width: 22 },
      createdAt, recordId
    ]
  },
  products: {
    label: "Products",
    columns: [
      { key: "product_id", label: "Product ID", width: 24 },
      { key: "university", label: "University", width: 24 },
      { key: "shirt_color", label: "Shirt color", width: 22 },
      { key: "base_price_thb", label: "Base price (THB)", kind: "number", width: 22 },
      { key: "available_sizes", label: "Available sizes", width: 32 },
      { key: "active", label: "Active", kind: "boolean", width: 12 },
      { key: "sort_order", label: "Sort order", kind: "number", width: 14 },
      { key: "image_url", label: "Image URL", width: 48 },
      createdAt, updatedAt, recordId
    ]
  },
  product_images: {
    label: "Product Images",
    columns: [
      { key: "product_id", label: "Product ID", width: 24 },
      { key: "image_url", label: "Image URL", width: 48 },
      { key: "sort_order", label: "Sort order", kind: "number", width: 14 },
      createdAt, updatedAt, recordId
    ]
  }
};

export type AdminDataSnapshot = {
  loadedAt: string;
  tables: Record<DataTableId, DataRow[]>;
};

export function displayDataCell(value: DataCell, column: DataColumn): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (column.kind === "date" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").slice(0, 19);
  }
  return String(value);
}

export function selectDataRows(
  rows: DataRow[], columns: DataColumn[], search: string,
  sort: { key: string; direction: "asc" | "desc" }
) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = query
    ? rows.filter((row) => columns.some((column) =>
      displayDataCell(row[column.key], column).toLocaleLowerCase().includes(query)))
    : [...rows];
  const column = columns.find((entry) => entry.key === sort.key);
  return filtered.sort((a, b) => {
    const left = a[sort.key];
    const right = b[sort.key];
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const result = typeof left === "number" && typeof right === "number"
      ? left - right
      : column?.kind === "date"
        ? Date.parse(String(left)) - Date.parse(String(right))
        : String(left).localeCompare(String(right), "en", { numeric: true });
    return sort.direction === "asc" ? result : -result;
  });
}
