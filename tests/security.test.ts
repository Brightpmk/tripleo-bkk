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
    expect(envExample).toContain("GOOGLE_PRODUCTS_RANGE");
    expect(envExample).toContain("GOOGLE_DRIVE_CLIENT_ID");
    expect(envExample).toContain("GOOGLE_DRIVE_CLIENT_SECRET");
    expect(envExample).toContain("GOOGLE_DRIVE_REFRESH_TOKEN");
    expect(envExample).not.toContain("GOOGLE_DRIVE_SLIP_FOLDER_ID");
    expect(envExample).toContain("ADMIN_PASSWORD_HASH");
    expect(envExample).toContain("ADMIN_SESSION_SECRET");
    expect(envExample).toContain("BLOB_STORE_ID");
    expect(envExample).toContain("PAYMENT_SLIP_BLOB_STORE_ID");
    expect(envExample).toContain("SUPABASE_URL");
    expect(envExample).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(envExample).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(envExample).not.toContain("ADMIN_PASSWORD=");
  });

  it("keeps payment-slip storage server-only and private", () => {
    const source = readFileSync("lib/server/payment-slip-storage.ts", "utf8");

    expect(source).toContain('import "server-only"');
    expect(source).toContain('access: "private"');
    expect(source).not.toContain('access: "public"');
    expect(source).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(source).not.toContain("anyone");
    expect(source).not.toContain("webViewLink");
    expect(source).not.toContain("permissions.create");
  });

  it("does not reference Drive OAuth secrets from client modules", () => {
    const clientSource = readFileSync("components/StorefrontApp.tsx", "utf8");

    expect(clientSource).not.toContain("GOOGLE_DRIVE_CLIENT_ID");
    expect(clientSource).not.toContain("GOOGLE_DRIVE_CLIENT_SECRET");
    expect(clientSource).not.toContain("GOOGLE_DRIVE_REFRESH_TOKEN");
    expect(clientSource).not.toContain("GOOGLE_DRIVE_SLIP_FOLDER_ID");
  });

  it("keeps all admin, Blob, Sheets, and Drive secrets out of client modules", () => {
    const clientSources = [
      "components/StorefrontApp.tsx",
      "app/admin/AdminShell.tsx",
      "app/admin/products/AdminProductsManager.tsx",
      "app/admin/orders/AdminOrdersView.tsx",
      "app/admin/orders/[orderId]/AdminOrderDetailView.tsx",
      "app/admin/login/AdminLoginForm.tsx"
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const secrets = [
      "ADMIN_PASSWORD_HASH",
      "ADMIN_SESSION_SECRET",
      "BLOB_STORE_ID",
      "PAYMENT_SLIP_BLOB_STORE_ID",
      "VERCEL_OIDC_TOKEN",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
      "GOOGLE_DRIVE_CLIENT_SECRET",
      "GOOGLE_DRIVE_REFRESH_TOKEN"
    ];

    for (const secret of secrets) {
      expect(clientSources).not.toContain(secret);
    }
  });
});
