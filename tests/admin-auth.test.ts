import { hash } from "bcryptjs";
import { sealData, unsealData } from "iron-session";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("admin authentication", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the correct bcrypt password and rejects an incorrect one", async () => {
    const { verifyAdminPassword } = await import("@/lib/server/admin-auth");
    const passwordHash = await hash("correct horse battery staple", 4);

    await expect(
      verifyAdminPassword("correct horse battery staple", passwordHash)
    ).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong password", passwordHash)).resolves.toBe(false);
  });

  it("accepts a live session and rejects expired or incomplete sessions", async () => {
    const { isAdminSessionValid } = await import("@/lib/server/admin-auth");
    const now = Date.now();

    expect(
      isAdminSessionValid({ authenticated: true, expiresAt: now + 1_000 }, now)
    ).toBe(true);
    expect(
      isAdminSessionValid({ authenticated: true, expiresAt: now - 1 }, now)
    ).toBe(false);
    expect(isAdminSessionValid({}, now)).toBe(false);
  });

  it("creates an expiring session and logout destroys it", async () => {
    const { establishAdminSession, invalidateAdminSession, isAdminSessionValid } =
      await import("@/lib/server/admin-auth");
    const save = vi.fn(async () => undefined);
    const destroy = vi.fn();
    const session = { save, destroy } as unknown as Parameters<
      typeof establishAdminSession
    >[0];

    await establishAdminSession(session, 1_000);
    expect(isAdminSessionValid(session, 1_001)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    invalidateAdminSession(session);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered encrypted session", async () => {
    const secret = "a-secure-test-secret-with-at-least-32-characters";
    const sealed = await sealData(
      { authenticated: true, expiresAt: Date.now() + 10_000 },
      { password: secret, ttl: 60 }
    );
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith("a") ? "b" : "a"}`;
    const unsealed = await unsealData<Record<string, unknown>>(tampered, {
      password: secret,
      ttl: 60
    });

    expect(unsealed.authenticated).not.toBe(true);
  });
});

describe("admin request protection", () => {
  it("requires same-origin mutation requests", async () => {
    const { isSameOriginRequest } = await import(
      "@/lib/server/admin-request-security"
    );

    expect(
      isSameOriginRequest(
        new Request("https://shop.example/api/admin/products", {
          method: "POST",
          headers: { origin: "https://shop.example" }
        })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        new Request("https://shop.example/api/admin/products", {
          method: "POST",
          headers: { origin: "https://attacker.example" }
        })
      )
    ).toBe(false);
  });

  it("limits repeated login failures per source", async () => {
    const {
      clearLoginRateLimitForTests,
      isLoginAllowed,
      recordLoginFailure
    } = await import("@/lib/server/admin-request-security");
    clearLoginRateLimitForTests();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(isLoginAllowed("192.0.2.10", 1_000)).toBe(true);
      recordLoginFailure("192.0.2.10", 1_000);
    }

    expect(isLoginAllowed("192.0.2.10", 1_000)).toBe(false);
    expect(isLoginAllowed("192.0.2.11", 1_000)).toBe(true);
    expect(isLoginAllowed("192.0.2.10", 1_000 + 15 * 60 * 1_000)).toBe(true);
    clearLoginRateLimitForTests();
  });
});
