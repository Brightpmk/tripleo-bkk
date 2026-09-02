import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readEffectiveCss } from "./helpers/effective-css";

const projectRoot = resolve(__dirname, "..");

function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf-8");
}

const layout = readSource("app/layout.tsx");
// globals.css is an import entrypoint; assert on the inlined result.
const css = readEffectiveCss();
const adminCss = readSource("app/admin/admin.css");

describe("English typography is untouched", () => {
  it("still loads Inter for Latin body and UI", () => {
    expect(layout).toContain("Inter({");
    expect(layout).toContain('variable: "--font-sans"');
  });

  it("still loads Cormorant Garamond for the wordmark and serif accent", () => {
    expect(layout).toContain("Cormorant_Garamond({");
    expect(layout).toContain('variable: "--font-serif"');
    expect(css).toContain('"Cormorant Garamond"');
  });

  it("keeps the display headings at their original weight", () => {
    // The Thai pass had lightened these to 700; they are 800 again.
    const displayXl = css.slice(css.indexOf(".display-xl {"));
    const displayLg = css.slice(css.indexOf(".display-lg {"));

    expect(displayXl.slice(0, 300)).toContain("font-weight: 800");
    expect(displayLg.slice(0, 300)).toContain("font-weight: 800");
  });

  it("keeps the original wordmark size and the numeric monospace stack", () => {
    const wordmark = css.slice(css.indexOf(".wordmark {"));
    expect(wordmark.slice(0, 400)).toContain("font-size: 1.1875rem");

    expect(css).toContain("--font-mono:");
    expect(css).toContain("var(--font-mono)");
  });

  it("changes no existing English type rule — only adds Thai ones", () => {
    // Compares stylesheet *content* against HEAD rather than a file diff, so
    // splitting globals.css into ../styles/ registers as a move, not a
    // removal. A rule that genuinely disappears still fails here.
    const headCss = execFileSync("git", ["show", "HEAD:app/globals.css"], {
      cwd: projectRoot,
      encoding: "utf-8"
    });

    const present = new Set(
      [css, adminCss]
        .join(String.fromCharCode(10))
        .split(String.fromCharCode(10))
        .map((line) => line.trim())
        .filter(Boolean)
    );

    const removed = headCss
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("@import"))
      .filter((line) => !present.has(line));

    removed.forEach((line) =>
      expect(line, `unexpected removal: ${line}`).toMatch(
        /^(--font-body:|"Segoe UI",|Thonburi, sans-serif;|\/\* Type \*\/)/
      )
    );
  });

  it("leaves the admin stylesheet alone", () => {
    const diff = execFileSync(
      "git",
      ["diff", "--stat", "--", "app/admin/admin.css"],
      { cwd: projectRoot, encoding: "utf-8" }
    );
    expect(diff.trim()).toBe("");
    expect(adminCss).toContain("var(--font-body)");
  });
});

describe("Thai is served by a neutral system stack", () => {
  it("downloads no font for Thai", () => {
    expect(layout).not.toContain("IBM_Plex_Sans_Thai");
    expect(layout).not.toContain("Noto_Sans_Thai");
    expect(css).not.toContain("--font-thai");
    expect(css).not.toContain("@font-face");
    expect(css).not.toContain("fonts.googleapis.com");
  });

  it("loads only the two English families, through next/font", () => {
    const families = (
      layout.match(/import \{([^}]+)\} from "next\/font\/google";/)?.[1] ?? ""
    )
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    expect(families.sort()).toEqual(["Cormorant_Garamond", "Inter"]);
    expect((layout.match(/display: "swap"/g) ?? []).length).toBe(2);
  });

  it("resolves Thai through a plain system UI stack, behind Inter", () => {
    const body = css.match(/--font-body:([\s\S]*?);/)?.[1] ?? "";

    // Inter comes first, so Latin never reaches the system stack.
    expect(body.indexOf("--font-sans")).toBeLessThan(body.indexOf("Tahoma"));

    ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Tahoma", "Arial", "sans-serif"].forEach(
      (name) => expect(body, name).toContain(name)
    );

    // Nothing decorative, and no downloaded Thai face.
    expect(body).not.toContain("IBM Plex");
    expect(body).not.toContain("Noto Sans Thai");
  });

  it("keeps Thai running copy at a normal weight", () => {
    expect(css).toContain("--th-body-weight: 400");
    expect(css).toContain("--th-helper-weight: 400");
    // Weight is spent only where it carries meaning.
    expect(css).toContain("--th-label-weight: 600");
    expect(css).toContain("--th-section-weight: 600");
    expect(css).toContain("--th-cta-weight: 600");
  });
});

describe("Thai-only rules never reach a Latin element", () => {
  // Bounded: the header-fit block that follows is a layout fix, not type.
  const thaiBlock = css.slice(
    css.indexOf("Thai type roles"),
    css.indexOf("Header fit")
  );

  it("sets no font-family anywhere in the Thai block", () => {
    expect(thaiBlock).not.toContain("font-family");
  });

  it("never shrinks a font size or a tap target", () => {
    const sizes = [...thaiBlock.matchAll(/font-size:\s*([\d.]+)rem/g)].map(
      (match) => Number(match[1])
    );
    sizes.forEach((value) => expect(value).toBeGreaterThanOrEqual(0.6875));

    expect(thaiBlock).toContain("min-height: var(--tap)");
    expect(thaiBlock).not.toMatch(/min-height:\s*(?:[0-3]?\d)px/);
  });

  it("does not restyle the wordmark, brand tag, headings or prices", () => {
    [
      ".wordmark",
      ".uni-tag",
      ".display-xl",
      ".display-lg",
      ".serif-accent",
      ".product-card-price",
      ".detail-price",
      ".eyebrow"
    ].forEach((selector) =>
      expect(thaiBlock, selector).not.toContain(`${selector} {`)
    );
  });
});

describe("Thai has five roles and nothing else", () => {
  const roles = [
    ["body", "--th-body", "1rem", "400", "1.65"],
    ["label", "--th-label", "0.875rem", "600", "1.5"],
    ["section", "--th-section", "0.8125rem", "600", "1.45"],
    ["cta", "--th-cta", "0.9375rem", "600", "1.4"],
    ["helper", "--th-helper", "0.8125rem", "400", "1.6"]
  ] as const;

  const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("/* Space */"));
  const thaiBlock = css.slice(
    css.indexOf("Thai type roles"),
    css.indexOf("Header fit")
  );

  it.each(roles)(
    "defines the Thai %s role once, as tokens",
    (_name, prefix, size, weight, line) => {
      expect(rootBlock).toContain(`${prefix}-size: ${size}`);
      expect(rootBlock).toContain(`${prefix}-weight: ${weight}`);
      expect(rootBlock).toContain(`${prefix}-line: ${line}`);
    }
  );

  it("exposes each role as a reusable class", () => {
    [".th-body", ".th-label", ".th-section-label", ".th-cta", ".th-helper"].forEach(
      (cls) => expect(thaiBlock, cls).toContain(cls)
    );
  });

  it("sets no Thai size, weight, leading or tracking outside the tokens", () => {
    const roleSection = thaiBlock.slice(0, thaiBlock.indexOf("Structure, not type"));

    const literal = (property: string, allowed: RegExp) =>
      [...roleSection.matchAll(new RegExp(`${property}:\s*([^;}
]+)`, "g"))]
        .map((match) => match[1].trim())
        .filter((value) => !allowed.test(value));

    expect(literal("font-size", /^var\(--th-/)).toEqual([]);
    expect(literal("font-weight", /^var\(--th-/)).toEqual([]);
    expect(literal("line-height", /^var\(--th-/)).toEqual([]);
    expect(literal("letter-spacing", /^var\(--th-tracking\)/)).toEqual([]);
  });

  it("uses one muted tone for all secondary Thai text", () => {
    expect(css).toContain("--th-muted: var(--ink-2)");
    // The helper role is the only place a muted colour is decided.
    const helper = thaiBlock.slice(thaiBlock.indexOf("Role 5"));
    expect(helper).toContain("color: var(--th-muted)");
  });

  it("preserves hierarchy — the five roles are not all the same", () => {
    const sizes = new Set(roles.map(([, , size]) => size));
    const weights = new Set(roles.map(([, , , weight]) => weight));

    expect(sizes.size).toBeGreaterThan(2);
    expect(weights.size).toBeGreaterThan(1);
  });

  it("never lets a Thai role reach an English element", () => {
    const roleSection = thaiBlock.slice(0, thaiBlock.indexOf("Structure, not type"));

    // These three selectors are shared with English, so they may only be
    // targeted through the is-thai hook.
    [".btn", ".action-bar-total", ".state"].forEach((selector) => {
      const bare = new RegExp(`(^|[,\s])\${selector}(?![\w-])(?!\.is-thai)`, "m");
      expect(roleSection.match(bare), selector).toBeNull();
    });

    expect(roleSection).toContain(".btn.is-thai");
    expect(roleSection).toContain(".action-bar-total.is-thai dt");
    expect(roleSection).toContain(".state.is-thai p");
  });

  it("marks only Thai elements with the is-thai hook", () => {
    const thai = /[฀-๿]/;

    ["components/StorefrontApp.tsx", "app/tracking/TrackingView.tsx"].forEach(
      (file) => {
        const source = readSource(file);
        for (const match of source.matchAll(
          /className=(?:"|\{`)((?:btn|action-bar-total|state)[^"`]*is-thai[^"`]*)/g
        )) {
          const rest = source.slice(match.index ?? 0);
          const end = Math.min(
            ...["</button>", "</Link>", "</dl>", "</div>"]
              .map((token) => rest.indexOf(token))
              .filter((index) => index !== -1)
          );
          expect(rest.slice(0, end), match[1]).toMatch(thai);
        }
      }
    );
  });
});

describe("the serif accent only ever sets Latin", () => {
  const thai = /[฀-๿]/;
  const views = [
    "components/StorefrontApp.tsx",
    "components/UniversityLanding.tsx",
    "app/products/[productId]/ProductDetailView.tsx",
    "app/tracking/TrackingView.tsx",
    "app/not-found.tsx"
  ];

  it.each(views)("%s puts no Thai inside a serif span", (file) => {
    const source = readSource(file);
    const accents = [
      ...source.matchAll(/className="serif-(?:accent|italic)"[^>]*>([^<]*)</g)
    ].map((match) => match[1]);

    accents.forEach((text) => expect(text).not.toMatch(thai));
  });
});

describe("tracking page speaks Thai", () => {
  const thai = /[฀-๿]/;
  const view = readSource("app/tracking/TrackingView.tsx");
  const lib = readSource("lib/tracking.ts");

  it("translates the search form", () => {
    expect(view).toContain("ติดตามคำสั่งซื้อ");
    expect(view).toContain("ค้นหาด้วยเบอร์โทรศัพท์");
    expect(view).toContain("ค้นหาด้วยชื่อ-นามสกุล");
  });

  it("translates every stored status without renaming the keys", () => {
    expect(lib).toContain('pending: "รอตรวจสอบการชำระเงิน"');
    expect(lib).toContain('verified: "ชำระเงินแล้ว"');
    expect(lib).toContain('new: "รับคำสั่งซื้อแล้ว"');
    expect(lib).toContain('preparing: "กำลังเตรียมสินค้า"');
    expect(lib).toContain('shipped: "จัดส่งแล้ว"');
    expect(lib).toContain('completed: "สำเร็จ"');
    expect(lib).toContain('cancelled: "ยกเลิกแล้ว"');
  });

  it("translates the shipping block", () => {
    expect(view).toContain("บริษัทขนส่ง");
    expect(view).toContain("หมายเลขติดตามพัสดุ");
    expect(view).toContain("ยังไม่มีหมายเลขติดตามพัสดุ");
  });

  it("keeps the values that must not be translated", () => {
    expect(view).toContain("{order.orderId}");
    expect(view).toContain("{order.trackingNumber}");
    expect(view).toContain("{order.shippingProvider}");
    expect(view).toContain("{order.universityBrand}");
    expect(view).toContain("{item.size");
  });

  it("leaves no untranslated English sentence on the page", () => {
    const allowed = /^(Tripleo\.bkk|Bangkok|\?|—|·)$/;
    const textNodes = [...view.matchAll(/>\s*([^<>{}\n]{2,})\s*</g)]
      .map((match) => match[1].trim())
      .filter((text) => /[A-Za-z]/.test(text))
      .filter((text) => !thai.test(text))
      .filter((text) => !allowed.test(text))
      .filter((text) => !/[?:)(=]/.test(text));

    expect(textNodes).toEqual([]);
  });

  it("shows the tracking entry in Thai in every header and footer", () => {
    [
      "components/StorefrontApp.tsx",
      "app/products/[productId]/ProductDetailView.tsx",
      "app/not-found.tsx"
    ].forEach((file) => {
      const source = readSource(file);
      expect(source, file).toContain("ติดตามคำสั่งซื้อ");
      expect(source, file).not.toContain("Track order");
    });
  });
});
