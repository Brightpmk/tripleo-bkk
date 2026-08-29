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
  });
});
