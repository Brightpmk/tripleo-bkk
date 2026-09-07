import { describe, expect, it, vi } from "vitest";
import { orderPersistenceDiagnostics } from "@/lib/server/order-persistence-diagnostics";

vi.mock("server-only", () => ({}));

describe("order persistence diagnostics", () => {
  it("keeps database codes without exposing raw messages or failing rows", () => {
    const result = orderPersistenceDiagnostics({
      code: "23514",
      message: 'Constraint failed for customer Ada Lovelace',
      details: 'Failing row contains (0812345678, 123 Test Road, private-slip-id)',
      hint: 'secret-service-role-key'
    }, "supabase-create-order");
    expect(result).toEqual({
      operation: "supabase-create-order",
      code: "23514",
      message: "Check constraint failed."
    });
  });

  it("identifies OAuth rejection without logging request credentials", () => {
    expect(orderPersistenceDiagnostics({
      response: { status: 400, data: { error: "invalid_grant", error_description: "private" } },
      config: { data: "refresh_token=secret" }
    }, "drive-slip-upload")).toEqual({
      operation: "drive-slip-upload", code: "invalid_grant",
      message: "Google Drive OAuth refresh rejected.", status: 400
    });
  });

  it("discards arbitrary errors and malformed codes", () => {
    expect(orderPersistenceDiagnostics({ code: "private-secret", message: "private" }, "supabase-create-order"))
      .toEqual({ operation: "supabase-create-order", message: "Supabase order persistence failed." });
    expect(orderPersistenceDiagnostics(null, "drive-slip-upload"))
      .toEqual({ operation: "drive-slip-upload", message: "Google Drive slip upload failed." });
  });
});
