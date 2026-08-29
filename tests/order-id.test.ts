import { describe, expect, it } from "vitest";
import { createServerOrderId } from "@/lib/server/order-id";

describe("server order IDs", () => {
  it("creates a public readable ID with year and random suffix", () => {
    const id = createServerOrderId(new Date("2026-08-29T00:00:00.000Z"));

    expect(id).toMatch(/^KG-2026-[A-F0-9]{8}$/);
  });

  it("does not generate the same ID repeatedly", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () =>
        createServerOrderId(new Date("2026-08-29T00:00:00.000Z"))
      )
    );

    expect(ids.size).toBe(100);
  });
});
