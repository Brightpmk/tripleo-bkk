import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("admin order deletion UX and styling", () => {
  const cssPath = resolve(__dirname, "../app/admin/admin.css");
  const css = readFileSync(cssPath, "utf-8");

  it("does not require a typed confirmation field", () => {
    const viewPath = resolve(
      __dirname,
      "../app/admin/orders/[orderId]/AdminOrderDetailView.tsx"
    );
    const viewCode = readFileSync(viewPath, "utf-8");

    expect(viewCode).not.toContain("admin-confirm-field");
    expect(viewCode).not.toContain("Type ");
    expect(viewCode).not.toContain("typed");
  });

  it("implements a two-step confirmation flow", () => {
    const viewPath = resolve(
      __dirname,
      "../app/admin/orders/[orderId]/AdminOrderDetailView.tsx"
    );
    const viewCode = readFileSync(viewPath, "utf-8");

    // Step 1 check
    expect(viewCode).toContain("Delete this order?");
    expect(viewCode).toContain("Continue");

    // Step 2 check
    expect(viewCode).toContain("Are you absolutely sure?");
    expect(viewCode).toContain("Delete Order");

    // Displays context in Step 1
    expect(viewCode).toContain("order.orderId");
    expect(viewCode).toContain("order.customerName");
    expect(viewCode).toContain("formatThb(order.totalThb)");
  });

  it("styles the danger trigger as a responsive full-width button on narrow viewports", () => {
    const match = css.match(/\.admin-danger-trigger\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("width: 100%");
    expect(rules).toContain("min-height: 46px");
    expect(rules).toContain("var(--bad-line)");
  });

  it("ensures confirmation dialog fits viewports with scrollable body and safe wrapping", () => {
    const confirmMatch = css.match(/\.admin-confirm\s*\{([^}]+)\}/);
    expect(confirmMatch).toBeTruthy();
    const confirmRules = confirmMatch![1];

    expect(confirmRules).toContain("max-height: min(90dvh, 90vh)");
    expect(confirmRules).toContain("overflow-y: auto");
    expect(confirmRules).toContain("box-sizing: border-box");

    // Fact DD values and H2 wrap safely
    const h2Match = css.match(/\.admin-confirm\s+h2\s*\{([^}]+)\}/);
    expect(h2Match).toBeTruthy();
    expect(h2Match![1]).toContain("overflow-wrap: anywhere");

    const ddMatch = css.match(/\.admin-confirm-facts\s+dd\s*\{([^}]+)\}/);
    expect(ddMatch).toBeTruthy();
    expect(ddMatch![1]).toContain("overflow-wrap: anywhere");
  });

  it("provides touch-accessible action buttons", () => {
    const match = css.match(/\.admin-confirm-actions\s+\.admin-button\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("min-height: 48px");
    expect(rules).toContain("width: 100%");
  });
});
