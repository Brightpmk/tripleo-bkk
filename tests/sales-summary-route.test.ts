import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), sales: vi.fn() }));
vi.mock("@/lib/server/admin-auth", () => ({ hasValidAdminSession: mocks.session }));
vi.mock("@/lib/server/sales-summary", () => ({ getSalesSummary: mocks.sales }));
import { GET } from "@/app/api/admin/sales/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(true);
  mocks.sales.mockResolvedValue({ groups: [], sizes: [], units: 0, revenueThb: 0, orderCount: 0 });
});

describe("admin sales endpoint", () => {
  it("checks authentication before accessing sales data", async () => {
    mocks.session.mockResolvedValue(false);
    const response = await GET(new Request("https://shop.example/api/admin/sales"));
    expect(response.status).toBe(401);
    expect(mocks.sales).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("loads paid sales by default with private caching headers", async () => {
    const response = await GET(new Request("https://shop.example/api/admin/sales"));
    expect(response.status).toBe(200);
    expect(mocks.sales).toHaveBeenCalledWith({ payment: "verified", university: "all", from: "", to: "" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["payment=rejected", "from=2026-02-30", "from=2026-11-01&to=2026-10-01", "university=unknown"])("rejects invalid filter %s before reading data", async (query) => {
    const response = await GET(new Request(`https://shop.example/api/admin/sales?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.sales).not.toHaveBeenCalled();
  });

  it("does not expose customer data or provider details when loading fails", async () => {
    mocks.sales.mockRejectedValue(new Error("private database information"));
    const response = await GET(new Request("https://shop.example/api/admin/sales"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database information");
  });
});
