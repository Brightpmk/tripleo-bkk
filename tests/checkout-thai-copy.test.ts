import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateSlipFile } from "@/lib/slip";
import { validateOrderSubmission } from "@/lib/server/order-validation";
import type { Product } from "@/lib/catalog";

const projectRoot = resolve(__dirname, "..");
const thai = /[฀-๿]/;

function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf-8");
}

const storefront = readSource("components/StorefrontApp.tsx");

/** The checkout journey, from the section head down to the last button. */
function sectionOf(name: string) {
  const start = storefront.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);

  const rest = storefront.slice(start + 1);
  const next = rest.search(/\n\/\* ═|\nfunction [A-Z]/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("checkout keeps its English section headings", () => {
  it.each([
    ['Your <span className="serif-accent">Cart</span>', "cart"],
    ['Your <span className="serif-accent">Details</span>', "details"],
    ['Transfer &amp; <span className="serif-accent">Upload</span>', "payment"],
    ['Review <span className="serif-accent">Order</span>', "review"],
    ['Order <span className="serif-accent">Placed</span>', "success"]
  ])("keeps the %s heading", (heading) => {
    expect(storefront).toContain(heading);
  });

  it("explains every retained English heading with a Thai line", () => {
    const notes = [...storefront.matchAll(/className="section-head-note">\s*([^<]+)/g)]
      .map((match) => match[1].trim());

    // Cart, Details, Payment and Review each get one.
    expect(notes).toHaveLength(4);
    notes.forEach((note) => expect(note).toMatch(thai));
  });
});

describe("checkout supporting copy is Thai", () => {
  it.each(["CartSection", "CheckoutSection", "PaymentSection", "ReviewSection"])(
    "%s carries Thai copy",
    (name) => {
      expect(sectionOf(name)).toMatch(thai);
    }
  );

  it("uses the agreed Thai wording for money and delivery labels", () => {
    expect(storefront).toContain("ยอดรวมสินค้า");
    expect(storefront).toContain("ค่าจัดส่ง");
    expect(storefront).toContain("ยอดรวมทั้งหมด");
    expect(storefront).toContain("ดำเนินการสั่งซื้อ");
    expect(storefront).toContain("รับสินค้าด้วยตนเอง");
    expect(storefront).toContain("ที่อยู่สำหรับจัดส่ง");
    expect(storefront).toContain("ยอดที่ต้องชำระ");
    expect(storefront).toContain("อัปโหลดสลิปการชำระเงิน");
    expect(storefront).toContain("เลือกสลิปเรียบร้อยแล้ว");
    expect(storefront).toContain("ยืนยันคำสั่งซื้อ");
    expect(storefront).toContain("ย้อนกลับ");
  });

  it("leaves no untranslated English sentence in the checkout steps", () => {
    const allowed = /^(↑|←|×|−|\+|✓|\?|○|◇|!|Tripleo\.bkk|Bangkok)$/;

    ["CartSection", "CheckoutSection", "PaymentSection", "ReviewSection", "SuccessSection"].forEach(
      (name) => {
        const section = sectionOf(name);
        const textNodes = [...section.matchAll(/>\s*([^<>{}\n]{2,})\s*</g)]
          .map((match) => match[1].trim())
          .filter((text) => /[A-Za-z]/.test(text))
          .filter((text) => !thai.test(text))
          .filter((text) => !allowed.test(text))
          // The scan also catches the code between two JSX branches, and the
          // English headings this task deliberately keeps.
          .filter((text) => !/[?:)(=]/.test(text))
          .filter(
            (text) =>
              !/^(Your|Transfer &amp;|Review|Order|Cart|Details|Upload|Placed|Payment)$/.test(
                text
              )
          );

        expect({ name, textNodes }).toEqual({ name, textNodes: [] });
      }
    );
  });
});

describe("success screen", () => {
  const success = sectionOf("SuccessSection");

  it("keeps the order ID visible under a Thai label", () => {
    expect(storefront).toContain("หมายเลขคำสั่งซื้อ");
    expect(success).toContain("{order.orderId}");
  });

  it("never implies an uploaded slip has been approved", () => {
    expect(storefront).toContain("กำลังรอตรวจสอบการชำระเงิน");
    expect(storefront).toContain("การอัปโหลดสลิปยังไม่ถือว่าชำระเงินสำเร็จ");
  });

  it("labels the stored payment statuses without renaming them", () => {
    const map = storefront.slice(
      storefront.indexOf("const paymentStatusLabels")
    );

    ["pending:", "verified:", "review_required:", "rejected:"].forEach((key) =>
      expect(map).toContain(key)
    );
  });
});

describe("checkout validation speaks Thai", () => {
  const product: Product = {
    id: "p-bm",
    primaryUniversityId: "bangmod",
    sellableUniversityIds: ["bangmod"],
    name: "Bone Tee",
    colorName: "Bone",
    priceThb: 390,
    image: "/products/product-placeholder.svg",
    availableSizes: ["M"],
    active: true,
    sortOrder: 1
  };

  it("returns Thai field errors for an empty checkout", () => {
    const result = validateOrderSubmission(
      {
        universityId: "bangmod",
        checkout: {
          fullName: "",
          phone: "",
          deliveryMethod: "shipping",
          shippingAddress: ""
        },
        items: [{ productId: "p-bm", size: "M", quantity: 1 }],
        slipSelected: false,
        submissionKey: "k"
      },
      [product]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.fieldErrors.fullName).toBe("กรุณากรอกชื่อ-นามสกุล");
    expect(result.fieldErrors.phone).toBe("กรุณากรอกเบอร์โทรศัพท์");
    expect(result.fieldErrors.shippingAddress).toBe(
      "กรุณากรอกที่อยู่สำหรับจัดส่ง"
    );
    expect(result.fieldErrors.slipSelected).toBe(
      "กรุณาอัปโหลดสลิปการชำระเงิน"
    );
    expect(result.message).toMatch(thai);
  });

  it("keeps validation behaviour identical — only the wording changed", () => {
    const result = validateOrderSubmission(
      {
        universityId: "bangmod",
        checkout: {
          fullName: "สมชาย ใจดี",
          phone: "0812345678",
          deliveryMethod: "pickup",
          shippingAddress: ""
        },
        items: [
          { productId: "p-bm", size: "M", quantity: 2, displayedUnitPriceThb: 390 }
        ],
        slipSelected: true,
        submissionKey: "k"
      },
      [product]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items[0].unitPriceThb).toBe(390);
    expect(result.order.items[0].quantity).toBe(2);
    expect(result.order.itemSubtotalThb).toBe(780);
    expect(result.order.shippingFeeThb).toBe(0);
  });

  it("renders a message for every field it can mark invalid", () => {
    // aria-describedby points at an id, so the element it names has to exist.
    // Without it, Continue blocks with no visible reason - which is exactly
    // what happened to the shipping address field.
    const section = sectionOf("CheckoutSection");

    ["checkout-name", "checkout-phone", "checkout-address"].forEach((field) => {
      expect(section, `${field} error span`).toContain(
        `id="${field}-error"`
      );
    });

    // The phone field describes a hint when it is valid, so that id must
    // resolve too. The address field has no hint, so it must not name one.
    expect(section).toContain('id="checkout-phone-hint"');
    expect(section).not.toContain('"checkout-address-hint"');
  });

  it("requires a shipping address only when shipping is selected", () => {
    const shipping = validateOrderSubmission(
      {
        universityId: "ladkrabang",
        checkout: {
          fullName: "สมชาย ใจดี",
          phone: "0812345678",
          deliveryMethod: "shipping",
          shippingAddress: "   "
        },
        items: [{ productId: "p-lkb", size: "M", quantity: 1, displayedUnitPriceThb: 390 }],
        slipSelected: true,
        submissionKey: "k"
      },
      [{ ...product, id: "p-lkb", primaryUniversityId: "ladkrabang", sellableUniversityIds: ["ladkrabang"] }]
    );

    expect(shipping.ok).toBe(false);
    expect(shipping.ok ? "" : shipping.fieldErrors.shippingAddress).toBe(
      "กรุณากรอกที่อยู่สำหรับจัดส่ง"
    );

    // Pickup never asks for one.
    const pickup = validateOrderSubmission(
      {
        universityId: "bangmod",
        checkout: {
          fullName: "สมชาย ใจดี",
          phone: "0812345678",
          deliveryMethod: "pickup",
          shippingAddress: ""
        },
        items: [{ productId: "p-bm", size: "M", quantity: 1, displayedUnitPriceThb: 390 }],
        slipSelected: true,
        submissionKey: "k"
      },
      [product]
    );

    expect(pickup.ok).toBe(true);
  });

  it("explains a rejected slip in Thai", () => {
    const wrongType = validateSlipFile({ size: 1024, type: "application/pdf" });
    expect(wrongType.ok).toBe(false);
    expect(wrongType.ok ? "" : wrongType.message).toMatch(thai);

    const tooBig = validateSlipFile({ size: 9 * 1024 * 1024, type: "image/jpeg" });
    expect(tooBig.ok).toBe(false);
    expect(tooBig.ok ? "" : tooBig.message).toMatch(thai);
  });

  it("never leaks a backend detail into a customer message", () => {
    const service = readSource("lib/server/order-service.ts");
    const route = readSource("app/api/orders/route.ts");

    [service, route].forEach((source) => {
      const messages = [...source.matchAll(/message:\s*"([^"]+)"/g)].map(
        (match) => match[1]
      );
      messages.forEach((message) => {
        expect(message).toMatch(thai);
        expect(message).not.toMatch(/supabase|drive|blob|sheet|catalog/i);
      });
    });
  });
});

describe("out-of-scope surfaces are untouched", () => {
  it("leaves the landing page main structure in English", () => {
    const landing = readSource("components/UniversityLanding.tsx");
    expect(landing).toContain("Select your");
    expect(landing).toContain("university collections");
  });

  it("now shows the Track Order page in Thai too", () => {
    const tracking = readSource("app/tracking/TrackingView.tsx");

    expect(tracking).toContain("ติดตามคำสั่งซื้อ");
    expect(tracking).toContain("ไม่พบคำสั่งซื้อ");
    expect(tracking).not.toContain("Track your");
    expect(tracking).not.toContain("No orders found");
    expect(readSource("lib/tracking.ts")).toContain("รอตรวจสอบการชำระเงิน");
  });

  it("leaves the shop grid heading and admin alone", () => {
    expect(sectionOf("ShopSection")).toContain(
      'The <span className="serif-accent">Collection</span>'
    );
    expect(readSource("app/admin/AdminShell.tsx")).not.toMatch(thai);
  });
});
