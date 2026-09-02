import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname, "..");

function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf-8");
}

describe("cart items navigation to product detail", () => {
  const storefront = readSource("components/StorefrontApp.tsx");
  const cartCss = readSource("styles/components/cart.css");

  function cartSection() {
    const start = storefront.indexOf("function CartSection(");
    expect(start).toBeGreaterThan(-1);
    const rest = storefront.slice(start);
    const next = rest.search(/\nfunction [A-Z]/);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("links the product image to the product detail route /products/[productId]", () => {
    const section = cartSection();
    expect(section).toContain('href={`/products/${item.productId}`}');
    expect(section).toContain('className="cart-row-media-link"');
    expect(section).toContain("<ProductImage");
  });

  it("links the product title to the product detail route /products/[productId]", () => {
    const section = cartSection();
    expect(section).toContain('className="cart-row-name cart-row-link"');
    expect(section).toContain("{item.productName}");
  });

  it("provides accessible aria-label on the media link", () => {
    const section = cartSection();
    expect(section).toContain(
      'aria-label={`ดูรายละเอียดสินค้า ${item.productName} — ${item.colorName}`}'
    );
  });

  it("does not wrap quantity stepper or remove buttons inside navigation links", () => {
    const section = cartSection();
    // Verify remove button is outside the links
    expect(section).toMatch(
      /<\/div>\s*<button[^>]*className="icon-btn cart-row-remove"/
    );
    // Verify quantity stepper is in cart-row-foot outside the links
    expect(section).toMatch(
      /<div className="cart-row-foot">\s*<QuantityStepper/
    );
  });

  it("styles media and title links with focus-visible and hover states", () => {
    expect(cartCss).toContain(".cart-row-media-link {");
    expect(cartCss).toContain(".cart-row-media-link:focus-visible {");
    expect(cartCss).toContain(".cart-row-name:focus-visible {");
    expect(cartCss).toContain(".cart-row-name:hover {");
  });
});
