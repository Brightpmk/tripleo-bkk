import { adminProductSizes } from "./admin-products";
import { universities } from "./catalog";

export const salesPaymentOptions = [
  { value: "verified", label: "Paid orders" },
  { value: "all", label: "All valid orders" },
  { value: "pending", label: "Pending payment" },
  { value: "review_required", label: "Payment review required" }
] as const;

export type SalesFilters = {
  university: string;
  payment: (typeof salesPaymentOptions)[number]["value"];
  from: string;
  to: string;
};

export const defaultSalesFilters: SalesFilters = {
  university: "all", payment: "verified", from: "", to: ""
};

export type SalesOrder = {
  orderId: string;
  university: string;
  createdAt: string;
  paymentStatus: string;
  orderStatus: string;
};
export type SalesItem = {
  orderId: string;
  productId: string;
  shirtColor: string;
  size: string;
  quantity: number;
  lineTotalThb: number;
};
export type SalesProduct = {
  productId: string;
  university: string;
  shirtColor: string;
  imageUrl: string;
  availableSizes: string[];
  active: boolean;
  sortOrder: number;
};
export type SalesProductSummary = SalesProduct & {
  historical: boolean;
  quantities: Record<string, number>;
  units: number;
  revenueThb: number;
};
export type UniversitySalesSummary = {
  university: string;
  name: string;
  brand: string;
  products: SalesProductSummary[];
  quantities: Record<string, number>;
  units: number;
  revenueThb: number;
  orderCount: number;
};
export type SalesSummary = {
  groups: UniversitySalesSummary[];
  sizes: string[];
  units: number;
  revenueThb: number;
  orderCount: number;
  loadedAt: string;
};

export function validateSalesFilters(filters: SalesFilters): string | null {
  if (!salesPaymentOptions.some((option) => option.value === filters.payment)) return "Select a valid payment status.";
  if (filters.university !== "all" && !universities.some((university) => university.sheetValue === filters.university)) return "Select a valid university.";
  for (const date of [filters.from, filters.to]) {
    if (!date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Enter a valid date range.";
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "Enter a valid date range.";
  }
  if (filters.from && filters.to && filters.from > filters.to) return "Start date must be on or before end date.";
  return null;
}

export function buildSalesSummary(
  source: { orders: SalesOrder[]; items: SalesItem[]; products: SalesProduct[] },
  filters: SalesFilters = defaultSalesFilters,
  now = new Date()
): SalesSummary {
  const invalid = validateSalesFilters(filters);
  if (invalid) throw new Error(invalid);
  const groups = new Map<string, UniversitySalesSummary>();
  const products = new Map<string, Map<string, SalesProductSummary>>();
  const groupOrders = new Map<string, Set<string>>();
  const countedOrders = new Set<string>();
  const sizes = new Set<string>(adminProductSizes);

  function getGroup(university: string) {
    let group = groups.get(university);
    if (!group) {
      const campus = universities.find((entry) => entry.sheetValue === university);
      group = {
        university, name: campus?.shortName ?? university, brand: campus?.brand ?? "",
        products: [], quantities: {}, units: 0, revenueThb: 0, orderCount: 0
      };
      groups.set(university, group);
      products.set(university, new Map());
      groupOrders.set(university, new Set());
    }
    return group;
  }

  for (const product of source.products) {
    if (filters.university !== "all" && product.university !== filters.university) continue;
    const group = getGroup(product.university);
    const summary: SalesProductSummary = {
      ...product, historical: false, quantities: {}, units: 0, revenueThb: 0
    };
    products.get(product.university)!.set(product.productId, summary);
    group.products.push(summary);
    product.availableSizes.forEach((size) => sizes.add(size));
  }

  const from = filters.from ? Date.parse(`${filters.from}T00:00:00+07:00`) : -Infinity;
  const to = filters.to ? Date.parse(`${filters.to}T00:00:00+07:00`) + 86_400_000 : Infinity;
  const orders = new Map(source.orders.filter((order) => {
    const created = Date.parse(order.createdAt);
    return order.orderStatus !== "cancelled" &&
      ["verified", "pending", "review_required"].includes(order.paymentStatus) &&
      (filters.payment === "all" || order.paymentStatus === filters.payment) &&
      (filters.university === "all" || order.university === filters.university) &&
      created >= from && created < to;
  }).map((order) => [order.orderId, order]));
  const catalog = new Map(source.products.map((product) => [product.productId, product]));

  for (const item of source.items) {
    const order = orders.get(item.orderId);
    if (!order) continue;
    const group = getGroup(order.university);
    const campusProducts = products.get(order.university)!;
    let product = campusProducts.get(item.productId);
    if (!product) {
      const current = catalog.get(item.productId);
      product = {
        productId: item.productId, university: order.university,
        shirtColor: item.shirtColor, imageUrl: current?.imageUrl ?? "",
        availableSizes: current?.availableSizes ?? [], active: false,
        sortOrder: current?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        historical: true, quantities: {}, units: 0, revenueThb: 0
      };
      campusProducts.set(item.productId, product);
      group.products.push(product);
    }
    sizes.add(item.size);
    product.quantities[item.size] = (product.quantities[item.size] ?? 0) + item.quantity;
    product.units += item.quantity;
    product.revenueThb += item.lineTotalThb;
    group.quantities[item.size] = (group.quantities[item.size] ?? 0) + item.quantity;
    group.units += item.quantity;
    group.revenueThb += item.lineTotalThb;
    groupOrders.get(order.university)!.add(order.orderId);
    countedOrders.add(order.orderId);
  }

  const universityOrder: string[] = universities.map((entry) => entry.sheetValue);
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const first = universityOrder.indexOf(a.university);
    const second = universityOrder.indexOf(b.university);
    return (first < 0 ? Infinity : first) - (second < 0 ? Infinity : second) || a.name.localeCompare(b.name);
  });
  for (const group of sortedGroups) {
    group.orderCount = groupOrders.get(group.university)!.size;
    group.products.sort((a, b) => a.sortOrder - b.sortOrder || a.productId.localeCompare(b.productId, "en", { numeric: true }));
  }
  const standardSizes: string[] = [...adminProductSizes];
  const extraSizes = [...sizes].filter((size) => !standardSizes.includes(size)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return {
    groups: sortedGroups, sizes: [...standardSizes, ...extraSizes],
    units: sortedGroups.reduce((total, group) => total + group.units, 0),
    revenueThb: sortedGroups.reduce((total, group) => total + group.revenueThb, 0),
    orderCount: countedOrders.size, loadedAt: now.toISOString()
  };
}
