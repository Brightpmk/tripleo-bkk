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

  it("identifies Blob upload failure without logging provider details", () => {
    expect(orderPersistenceDiagnostics({
      message: "private provider detail",
      token: "secret"
    }, "blob-slip-upload")).toEqual({
      operation: "blob-slip-upload",
      message: "Private Blob payment slip upload failed."
    });
  });

  it("discards arbitrary errors and malformed codes", () => {
    expect(orderPersistenceDiagnostics({ code: "private-secret", message: "private" }, "supabase-create-order"))
      .toEqual({ operation: "supabase-create-order", message: "Supabase order persistence failed." });
    expect(orderPersistenceDiagnostics(null, "blob-slip-upload"))
      .toEqual({ operation: "blob-slip-upload", message: "Private Blob payment slip upload failed." });
  });
});
