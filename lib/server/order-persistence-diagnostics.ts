import "server-only";

type PersistenceOperation = "drive-slip-upload" | "supabase-create-order";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function orderPersistenceDiagnostics(
  error: unknown,
  operation: PersistenceOperation
) {
  const source = record(error);
  if (operation === "drive-slip-upload") {
    const response = record(source.response);
    const data = record(response.data);
    return {
      operation,
      ...(data.error === "invalid_grant"
        ? { code: "invalid_grant", message: "Google Drive OAuth refresh rejected." }
        : { message: "Google Drive slip upload failed." }),
      ...(typeof response.status === "number" ? { status: response.status } : {})
    };
  }

  // Database details can contain the entire failing row, including PII and
  // slip IDs. Only emit recognized codes and fixed diagnostic descriptions.
  const code = typeof source.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(source.code)
    ? source.code
    : undefined;
  const descriptions: Record<string, string> = {
    "23502": "Required database field is null.",
    "23503": "Foreign key constraint failed.",
    "23505": "Unique constraint failed.",
    "23514": "Check constraint failed.",
    "22P02": "Invalid database input syntax.",
    "22003": "Database numeric value out of range.",
    "42501": "Database permission denied.",
    PGRST202: "RPC signature is missing from the schema cache.",
    PGRST203: "RPC signature is ambiguous."
  };
  return {
    operation,
    ...(code ? { code } : {}),
    message: (code && descriptions[code]) || "Supabase order persistence failed."
  };
}
