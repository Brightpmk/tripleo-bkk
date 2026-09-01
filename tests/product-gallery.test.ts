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

  it("preserves catalog card cover cropping untouched", () => {
    const match = css.match(/(?:^|\n)\.product-card-media\s+img\s*\{([^}]+)\}/);
    expect(match).toBeTruthy();
    const rules = match![1];

    expect(rules).toContain("object-fit: cover");
  });
});
