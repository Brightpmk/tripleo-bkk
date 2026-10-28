import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getSalesSummary } from "@/lib/server/sales-summary";
import { defaultSalesFilters, validateSalesFilters, type SalesFilters } from "@/lib/sales-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  if (!(await hasValidAdminSession())) {
    return Response.json({ message: "Authentication required." }, { status: 401, headers });
  }
  const query = new URL(request.url).searchParams;
  const filters: SalesFilters = {
    university: query.get("university") ?? defaultSalesFilters.university,
    payment: (query.get("payment") ?? defaultSalesFilters.payment) as SalesFilters["payment"],
    from: query.get("from") ?? "", to: query.get("to") ?? ""
  };
  const invalid = validateSalesFilters(filters);
  if (invalid) return Response.json({ message: invalid }, { status: 400, headers });
  try {
    return Response.json(await getSalesSummary(filters), { headers });
  } catch {
    return Response.json({ message: "Sales summary could not be loaded. Please try again." }, { status: 500, headers });
  }
}
