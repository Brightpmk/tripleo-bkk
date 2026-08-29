import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server credential boundaries", () => {
  it("marks Google environment access as server-only", () => {
    const source = readFileSync("lib/server/env.ts", "utf8");

    expect(source).toContain('import "server-only"');
  });

  it("does not expose Google credential names as NEXT_PUBLIC values", () => {
    const envExample = readFileSync(".env.example", "utf8");

    expect(envExample).not.toContain("NEXT_PUBLIC");
    expect(envExample).toContain("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
    expect(envExample).toContain("GOOGLE_DRIVE_SLIP_FOLDER_ID");
  });

  it("keeps Drive implementation server-only and private", () => {
    const source = readFileSync("lib/server/payment-slip-storage.ts", "utf8");

    expect(source).toContain('import "server-only"');
    expect(source).not.toContain("anyone");
    expect(source).not.toContain("webViewLink");
    expect(source).not.toContain("permissions.create");
  });
});
