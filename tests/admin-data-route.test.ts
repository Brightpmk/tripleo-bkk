import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), snapshot: vi.fn(), workbook: vi.fn() }));
vi.mock("@/lib/server/admin-auth", () => ({ hasValidAdminSession: mocks.session }));
vi.mock("@/lib/server/admin-data", () => ({ getAdminDataSnapshot: mocks.snapshot }));
vi.mock("@/lib/server/admin-data-workbook", () => ({ createAdminDataWorkbook: mocks.workbook }));

import { GET as getData } from "@/app/api/admin/data/route";
import { GET as getExport } from "@/app/api/admin/data/export/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(true);
  mocks.snapshot.mockResolvedValue({ loadedAt: "2026-10-27T10:00:00Z", tables: {} });
  mocks.workbook.mockResolvedValue(Buffer.from("test-xlsx"));
});

describe.each([["data", getData], ["export", getExport]] as const)("admin %s endpoint", (_, handler) => {
  it("requires an admin session before reading customer data", async () => {
    mocks.session.mockResolvedValue(false);
    const response = await handler();
    expect(response.status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.workbook).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a generic, uncached error rather than a partial download or provider details", async () => {
    mocks.snapshot.mockRejectedValue(new Error("provider-secret-and-customer-data"));
    const response = await handler();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("provider-secret-and-customer-data");
    expect(mocks.workbook).not.toHaveBeenCalled();
  });
});

it("downloads the complete workbook with an xlsx filename and private headers", async () => {
  const response = await getExport();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="tripleo-data-2026-10-27.xlsx"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe("test-xlsx");
});
