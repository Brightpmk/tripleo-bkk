import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sizeChartGroups } from "@/lib/size-charts";
import { readEffectiveCss } from "./helpers/effective-css";

describe("size chart", () => {
  it("includes every supplied chart image exactly once", () => {
    const images = sizeChartGroups.flatMap((group) => group.images);
    const sources = images.map((image) => image.src);

    expect(sizeChartGroups.map((group) => group.id)).toEqual([
      "boxy",
      "womens-boxy"
    ]);
    expect(sources).toHaveLength(6);
    expect(new Set(sources).size).toBe(6);

    for (const source of sources) {
      expect(existsSync(resolve(process.cwd(), "public", source.slice(1)))).toBe(
        true
      );
    }
  });

  it("keeps charts uncropped and swipeable on mobile", () => {
    const css = readEffectiveCss();
    const imageRules = css.match(/\.size-chart-figure img\s*\{([^}]+)\}/)?.[1];

    expect(imageRules).toContain("object-fit: contain");
    expect(css).toContain("scroll-snap-type: x mandatory");
    expect(css).toContain("max-height: 100dvh");
    expect(css).toMatch(
      /@media \(max-width: 639px\)[\s\S]*?\.size-chart-trigger\.is-inline\s*\{[^}]*min-height: var\(--tap\)/
    );
  });

  it("is available from both the shop and product detail", () => {
    const shop = readFileSync(
      resolve(process.cwd(), "components/StorefrontApp.tsx"),
      "utf8"
    );
    const detail = readFileSync(
      resolve(
        process.cwd(),
        "app/products/[productId]/ProductDetailView.tsx"
      ),
      "utf8"
    );

    expect(shop).toContain("<SizeChartModal />");
    expect(detail).toContain('<SizeChartModal className="is-inline" />');
  });
});
