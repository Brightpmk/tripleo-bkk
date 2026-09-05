import { describe, expect, it } from "vitest";
import { readEffectiveCss } from "./helpers/effective-css";

describe("product detail gallery image fitting", () => {
  // globals.css is an import entrypoint; assert on the inlined result.
  const css = readEffectiveCss();

  it("sets object-fit: contain on product detail gallery slides", () => {
    // Extract .gallery-slide img block
    const match = css.match(/\.gallery-slide\s+img\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("object-fit: contain");
    expect(rules).not.toContain("object-fit: cover");
  });

  it("does not force product detail gallery slides into fixed 4:5 aspect ratio", () => {
    const match = css.match(/\.gallery-slide\s+img\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).not.toContain("aspect-ratio: 4 / 5");
  });

  it("allows gallery-track to adapt its aspect ratio dynamically", () => {
    const match = css.match(/\.gallery-track\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("aspect-ratio: var(--gallery-aspect");
    expect(rules).toContain("max-height:");
  });

  it("shows the whole catalog card image without cropping", () => {
    const match = css.match(/(?:^|\n)\.product-card-media\s+img\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    // Product photography is a fixed landscape frame, so the card shows the
    // full shot rather than a crop.
    expect(rules).toContain("object-fit: contain");
    expect(rules).not.toContain("object-fit: cover");
  });

  it("matches the catalog card frame to the product image ratio", () => {
    const match = css.match(/(?:^|\n)\.product-card-media\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("aspect-ratio: 1516 / 794");
    // A fixed ratio replaces the old portrait min-height box.
    expect(rules).not.toContain("min-height");
  });

  it("uses one card layout at every breakpoint", () => {
    // The old side-by-side row was built for a portrait crop. A landscape
    // frame sits full-width above the details at all widths, so no media
    // column override may survive.
    expect(css).not.toContain("minmax(120px, 40%)");
    expect(css).not.toContain("minmax(108px, 38%)");
    expect(css).not.toMatch(
      /\.product-card-media\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/
    );
  });
});
