"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCart } from "./CartProvider";
import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import {
  getAvailableDeliveryMethods,
  getProductsForUniversity,
  getShopPath,
  getUniversityById,
  isDeliveryMethodAllowed,
  productImagePlaceholder,
  type ShirtSize,
  type Product,
  type University,
  type UniversityId
} from "@/lib/catalog";
import {
  addCartItem,
  getCartItemSubtotal,
  getCartItemsForUniversity,
  getCartTotalQuantity,
  removeCartItem,
  updateCartQuantity,
  type CartItem
} from "@/lib/cart";
import { formatThb } from "@/lib/format";
import {
  type CheckoutDetails,
  type ConfirmedOrder,
  type PaymentStatus
} from "@/lib/orders";
import type { OrderSubmissionResult } from "@/lib/order-submission";
import {
  calculateOrderTotals,
  getShippingFee,
  type DeliveryMethod
} from "@/lib/pricing";
import { acceptedSlipMimeTypes, validateSlipFile } from "@/lib/slip";
import { formatBytes, optimizeSlipImage } from "@/lib/slip-image";
import {
  getSizeSurchargeThb,
  getUnitPriceThbForSize,
  hasSizeSurcharge,
  SIZE_SURCHARGE_THB
} from "@/lib/size-pricing";

/**
 * In-page checkout steps. Picking a university is no longer a step — it is a
 * route (`/` → `/shop/<slug>`), so the storefront always starts at "shop".
 */
type Step = "shop" | "cart" | "checkout" | "payment" | "review" | "success";

type ProductChoice = {
  size: ShirtSize;
  quantity: number;
};

type StorefrontAppProps = {
  initialProducts: Product[];
  /** Resolved from the `/shop/[university]` route param by the server. */
  university: University;
  catalogError?: string;
  initialStep?: Step;
};

const MAX_LINE_QUANTITY = 20;

type SubmitStage = "idle" | "uploading" | "confirming";

const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "กำลังรอตรวจสอบการชำระเงิน",
  verified: "ยืนยันการชำระเงินแล้ว",
  review_required: "กำลังตรวจสอบเพิ่มเติม",
  rejected: "การชำระเงินมีปัญหา กรุณาติดต่อเรา"
};

const submitStageLabels: Record<Exclude<SubmitStage, "idle">, string> = {
  uploading: "กำลังส่งสลิปการชำระเงิน",
  confirming: "กำลังยืนยันคำสั่งซื้อ"
};

const defaultCheckout: CheckoutDetails = {
  fullName: "",
  phone: "",
  deliveryMethod: "pickup",
  shippingAddress: ""
};

const stepLabels: Record<Step | "select", string> = {
  select: "University",
  shop: "Shop",
  cart: "Cart",
  checkout: "Details",
  payment: "Payment",
  review: "Review",
  success: "Done"
};

/**
 * The rail still opens with "University", but that chip is a route back to
 * `/` rather than a step this component can enter.
 */
const railSteps = [
  "select",
  "shop",
  "cart",
  "checkout",
  "payment",
  "review"
] as const;

type RailStep = (typeof railSteps)[number];

export function StorefrontApp({
  initialProducts,
  university,
  catalogError = "",
  initialStep
}: StorefrontAppProps) {
  // Cart and campus live in the shared provider, which sits above the router
  // in the root layout, so routing between `/`, `/shop/<slug>` and
  // `/products/<id>` never discards the cart. Pricing rules are unchanged.
  const {
    items: storedCartItems,
    setItems: setCartItems,
    universityId: storedUniversityId,
    setUniversityId: setStoredUniversityId
  } = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams?.get("step");

  const universityId = university.id;
  const shopPath = getShopPath(university);

  const [step, setStep] = useState<Step>(() => initialStep ?? "shop");
  const [choices, setChoices] = useState<Record<string, ProductChoice>>(() =>
    Object.fromEntries(
      initialProducts.map((product) => [
        product.id,
        {
          size: product.availableSizes[0] ?? "M",
          quantity: 1
        }
      ])
    )
  );
  const [checkoutDetails, setCheckout] =
    useState<CheckoutDetails>(defaultCheckout);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState("");
  const slipPreviewUrlRef = useRef("");
  const [slipError, setSlipError] = useState("");
  const [slipOptimizing, setSlipOptimizing] = useState(false);
  const [slipSavedFromBytes, setSlipSavedFromBytes] = useState(0);
  const [submitStage, setSubmitStage] = useState<SubmitStage>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableProducts = getProductsForUniversity(
    initialProducts,
    universityId
  );

  // Only Bangmod offers pickup. The method is derived rather than synced, so
  // opening another campus can never leave checkout on an option that
  // university does not support.
  const checkout = useMemo<CheckoutDetails>(() => {
    const allowedMethods = getAvailableDeliveryMethods(universityId);

    return allowedMethods.includes(checkoutDetails.deliveryMethod)
      ? checkoutDetails
      : { ...checkoutDetails, deliveryMethod: allowedMethods[0] };
  }, [checkoutDetails, universityId]);

  // The URL is the single source of truth for which campus is open. A cart is
  // per-campus, so anything left over from another shop is dropped rather than
  // priced against this one - the same rule the old select step enforced.
  const cartItems = useMemo(
    () => getCartItemsForUniversity(storedCartItems, universityId),
    [storedCartItems, universityId]
  );
  const hasForeignCartItems = cartItems.length !== storedCartItems.length;

  // Point the shared cart at the campus this route is for. Navigating within
  // the same campus (or out to a product page and back) is a no-op here, so
  // ordinary navigation never resets the cart.
  useEffect(() => {
    if (storedUniversityId !== universityId) {
      setStoredUniversityId(universityId);
    }
  }, [universityId, storedUniversityId, setStoredUniversityId]);

  useEffect(() => {
    if (hasForeignCartItems) {
      setCartItems((current) =>
        getCartItemsForUniversity(current, universityId)
      );
    }
  }, [hasForeignCartItems, universityId, setCartItems]);

  // `?step=cart` is the hand-off from the product detail page. Consume it and
  // strip it, so the shop URL stays clean and shareable.
  useEffect(() => {
    if (stepParam !== "cart") {
      return;
    }

    startTransition(() => {
      setStep("cart");
    });
    window.history.replaceState(null, "", shopPath);
  }, [stepParam, shopPath]);

  const totals = useMemo(
    () => calculateOrderTotals(cartItems, checkout.deliveryMethod),
    [cartItems, checkout.deliveryMethod]
  );

  // Every step is a screen of its own: always start it at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);

  // Release the last preview URL when the storefront unmounts.
  useEffect(
    () => () => {
      if (slipPreviewUrlRef.current) {
        URL.revokeObjectURL(slipPreviewUrlRef.current);
      }
    },
    []
  );

  // Keeps the file and its local preview URL in lockstep, so the shopper
  // can verify they picked the right screenshot before they commit.
  function setSlip(file: File | null) {
    if (slipPreviewUrlRef.current) {
      URL.revokeObjectURL(slipPreviewUrlRef.current);
    }

    const objectUrl = file ? URL.createObjectURL(file) : "";
    slipPreviewUrlRef.current = objectUrl;
    setSlipFile(file);
    setSlipPreviewUrl(objectUrl);
  }

  function updateChoice(productId: string, nextChoice: Partial<ProductChoice>) {
    setChoices((current) => ({
      ...current,
      [productId]: {
        ...current[productId],
        ...nextChoice
      }
    }));
  }

  function addProduct(product: Product) {
    const choice = choices[product.id] ?? {
      size: product.availableSizes[0] ?? "M",
      quantity: 1
    };

    const selectedSize = product.availableSizes.includes(choice.size)
      ? choice.size
      : product.availableSizes[0] ?? "M";

    setCartItems((current) =>
      addCartItem(current, {
        product,
        universityId,
        size: selectedSize,
        quantity: choice.quantity
      })
    );
  }

  function validateCheckout() {
    const nextErrors: Record<string, string> = {};

    if (!checkout.fullName.trim()) {
      nextErrors.fullName = "กรุณากรอกชื่อ-นามสกุล";
    }

    if (!checkout.phone.trim()) {
      nextErrors.phone = "กรุณากรอกเบอร์โทรศัพท์";
    }

    if (!isDeliveryMethodAllowed(universityId, checkout.deliveryMethod)) {
      nextErrors.deliveryMethod =
        universityId === "bangmod"
          ? "กรุณาเลือกวิธีรับสินค้า"
          : "มหาวิทยาลัยนี้รองรับเฉพาะการจัดส่งเท่านั้น";
    }

    if (
      checkout.deliveryMethod === "shipping" &&
      !checkout.shippingAddress.trim()
    ) {
      nextErrors.shippingAddress = "กรุณากรอกที่อยู่สำหรับจัดส่ง";
    }

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function continueToPayment() {
    if (validateCheckout()) {
      setStep("payment");
      return;
    }

    focusFirstInvalidField();
  }

  function navigateStep(nextStep: Step) {
    if (!canOpenStep(nextStep, cartItems, checkout, slipFile)) {
      if (nextStep === "payment" && !validateCheckout()) {
        focusFirstInvalidField();
      }
      return;
    }
    setStep(nextStep);
  }

  async function selectSlip(file: File | null) {
    setSlipError("");
    setSubmissionError("");
    setSlip(null);
    setSlipSavedFromBytes(0);

    if (!file) {
      return;
    }

    // Limits are still enforced against the file the customer actually
    // picked, before any optimisation — behaviour is unchanged.
    const validation = validateSlipFile(file);

    if (!validation.ok) {
      setSlipError(validation.message);
      return;
    }

    // Shrinking here rather than at submit time means the work overlaps the
    // review step, so Confirm has a small file ready to go. The server
    // re-validates whatever actually arrives.
    setSlipOptimizing(true);

    try {
      const optimized = await optimizeSlipImage(file);
      setSlip(optimized.file);
      setSlipSavedFromBytes(optimized.compressed ? optimized.originalBytes : 0);
    } finally {
      setSlipOptimizing(false);
    }
  }

  async function confirmOrder() {
    if (!slipFile || cartItems.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStage("uploading");
    setUploadPercent(0);
    setSubmissionError("");

    try {
      const orderPayload = {
        universityId,
        checkout,
        slipSelected: true,
        submissionKey,
        items: cartItems.map((item) => ({
          productId: item.productId,
          size: item.size,
          quantity: item.quantity,
          displayedUnitPriceThb: item.unitPriceThb
        }))
      };
      const formData = new FormData();
      formData.append("order", JSON.stringify(orderPayload));
      formData.append("slip", slipFile, slipFile.name);

      const result = await postOrder(formData, (percent) => {
        setUploadPercent(percent);

        // Bytes are all sent; the wait is now server-side.
        if (percent >= 100) {
          setSubmitStage("confirming");
        }
      });

      if (!result.ok) {
        setSubmissionError(result.message);
        setIsSubmitting(false);
        setSubmitStage("idle");
        return;
      }

      setOrder({
        orderId: result.order.orderId,
        createdAtIso: result.order.createdAtIso,
        universityId: result.order.universityId,
        items: cartItems,
        checkout,
        itemSubtotalThb: result.order.itemSubtotalThb,
        shippingFeeThb: result.order.shippingFeeThb,
        finalTotalThb: result.order.finalTotalThb,
        paymentStatus: result.order.paymentStatus,
        slipSelected: true
      });
      setSubmissionKey(createSubmissionKey());
      setStep("success");
    } catch {
      setSubmissionError("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
      setSubmitStage("idle");
    }
  }

  function resetOrder() {
    setCartItems([]);
    setCheckout(defaultCheckout);
    setSlip(null);
    setOrder(null);
    setFormErrors({});
    setSlipError("");
    setSlipSavedFromBytes(0);
    setSubmissionError("");
    setSubmissionKey(createSubmissionKey());
    setStep("shop");
  }

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-left">
          <Link className="wordmark" href="/">
            Tripleo.bkk
          </Link>
          <span className="uni-tag" title={university.fullName}>
            <span className="uni-dot" aria-hidden="true" />
            {university.brand}
          </span>
        </div>

        <div className="header-right">
          <Link className="track-nav-btn is-thai" href="/tracking">
            ติดตามคำสั่งซื้อ
          </Link>
          {step !== "success" ? (
            <button
              className="cart-btn"
              type="button"
              onClick={() => setStep(cartItems.length > 0 ? "cart" : "shop")}
              aria-label={
                cartCount === 1 ? "Cart, 1 item" : `Cart, ${cartCount} items`
              }
            >
              Cart
              {cartCount > 0 ? (
                <span className="cart-btn-count" aria-hidden="true">
                  {cartCount}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </header>

      <div className="content-container">
        {step !== "success" ? (
          <StepProgress
            step={step}
            cartItems={cartItems}
            checkout={checkout}
            slipFile={slipFile}
            onNavigate={navigateStep}
            onLeaveShop={() => router.push("/")}
          />
        ) : null}

        {step === "shop" ? (
          <ShopSection
            catalogError={catalogError}
            products={availableProducts}
            university={university}
            choices={choices}
            onChoiceChange={updateChoice}
            onAddProduct={addProduct}
          />
        ) : null}

        {step === "cart" ? (
          <CartSection
            items={cartItems}
            university={university}
            onQuantityChange={(lineId, quantity) =>
              setCartItems((current) =>
                updateCartQuantity(current, lineId, quantity)
              )
            }
            onRemove={(lineId) =>
              setCartItems((current) => removeCartItem(current, lineId))
            }
            onContinue={() => setStep("checkout")}
            onShop={() => setStep("shop")}
          />
        ) : null}

        {step === "checkout" ? (
          <CheckoutSection
            checkout={checkout}
            errors={formErrors}
            items={cartItems}
            totals={totals}
            university={university}
            onChange={setCheckout}
            onContinue={continueToPayment}
          />
        ) : null}

        {step === "payment" ? (
          <PaymentSection
            finalTotalThb={totals.finalTotalThb}
            slipFile={slipFile}
            slipPreviewUrl={slipPreviewUrl}
            slipError={slipError}
            slipOptimizing={slipOptimizing}
            slipSavedFromBytes={slipSavedFromBytes}
            onSlipChange={selectSlip}
            onBack={() => setStep("checkout")}
            onContinue={() => slipFile && setStep("review")}
          />
        ) : null}

        {step === "review" ? (
          <ReviewSection
            checkout={checkout}
            isSubmitting={isSubmitting}
            items={cartItems}
            submissionError={submissionError}
            slipFile={slipFile}
            slipPreviewUrl={slipPreviewUrl}
            submitStage={submitStage}
            uploadPercent={uploadPercent}
            totals={totals}
            university={university}
            onBack={() => setStep("payment")}
            onConfirm={confirmOrder}
          />
        ) : null}

        {step === "success" && order ? (
          <SuccessSection order={order} onReset={resetOrder} />
        ) : null}
      </div>

      <footer className="site-footer">
        <span className="site-footer-brand">Tripleo.bkk</span>
        <span className="site-footer-note">
          Premium university streetwear · <span className="serif-italic">Bangkok</span>
        </span>
      </footer>
    </main>
  );
}

/* ════════════════════════════════════════════════════════════════
   Progress rail
   ════════════════════════════════════════════════════════════════ */
function StepProgress({
  step,
  cartItems,
  checkout,
  slipFile,
  onNavigate,
  onLeaveShop
}: {
  step: Step;
  cartItems: CartItem[];
  checkout: CheckoutDetails;
  slipFile: File | null;
  onNavigate: (step: Step) => void;
  onLeaveShop: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const currentIndex = Math.max(0, railSteps.indexOf(step as RailStep));

  // Keep the active chip visible without the shopper having to scroll for it.
  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>(
      '[aria-current="step"]'
    );
    active?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step]);

  return (
    <nav className="progress" aria-label="Checkout progress">
      <div className="progress-rail" ref={railRef}>
        {railSteps.map((railStep) => (
          <button
            className="progress-step"
            aria-current={step === railStep ? "step" : undefined}
            disabled={
              railStep !== "select" &&
              !canOpenStep(railStep, cartItems, checkout, slipFile)
            }
            key={railStep}
            onClick={() =>
              // "University" leaves the shop for the landing route; every
              // other chip is an in-page step.
              railStep === "select" ? onLeaveShop() : onNavigate(railStep)
            }
            type="button"
          >
            {stepLabels[railStep]}
          </button>
        ))}
      </div>
      <div className="progress-track">
        <span
          className="progress-fill"
          style={{
            width: `${((currentIndex + 1) / railSteps.length) * 100}%`
          }}
        />
      </div>
      <p className="progress-count">
        Step {currentIndex + 1} of {railSteps.length} · {stepLabels[step]}
      </p>
    </nav>
  );
}

/* ════════════════════════════════════════════════════════════════
   Shop
   ════════════════════════════════════════════════════════════════ */
function ShopSection({
  catalogError,
  products,
  university,
  choices,
  onChoiceChange,
  onAddProduct
}: {
  catalogError: string;
  products: Product[];
  university: University;
  choices: Record<string, ProductChoice>;
  onChoiceChange: (productId: string, choice: Partial<ProductChoice>) => void;
  onAddProduct: (product: Product) => void;
}) {
  const [addedProductId, setAddedProductId] = useState<string | null>(null);

  function handleAddProduct(product: Product) {
    onAddProduct(product);
    setAddedProductId(product.id);
    setTimeout(() => {
      setAddedProductId((current) => (current === product.id ? null : current));
    }, 1200);
  }

  return (
    <section className="step-section" id="shop">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">{university.brand}</p>
          <h2 className="display-lg">The <span className="serif-accent">Collection</span></h2>
        </div>
      </div>

      {catalogError ? (
        <div className="state is-error" role="alert">
          <span className="state-mark" aria-hidden="true">
            !
          </span>
          <h3>Catalog unavailable</h3>
          <p>{catalogError}</p>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="state">
          <span className="state-mark" aria-hidden="true">
            ◇
          </span>
          <h3>Nothing in stock yet</h3>
          <p>
            This university has no active drops right now. Check back soon for the
            next release.
          </p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map((product) => {
            const choice = choices[product.id] ?? {
              size: product.availableSizes[0] ?? "M",
              quantity: 1
            };
            const selectedSize = product.availableSizes.includes(choice.size)
              ? choice.size
              : product.availableSizes[0] ?? "M";
            const quantity = clampQuantity(choice.quantity, 1);
            const sizeSurchargeThb = getSizeSurchargeThb(selectedSize);
            const unitPriceThb = getUnitPriceThbForSize(
              product.priceThb,
              selectedSize
            );
            const hasSurchargedSize =
              product.availableSizes.some(hasSizeSurcharge);

            return (
              <article className="product-card" key={product.id}>
                {/* Cover image only — a grid never loads a full gallery. */}
                <Link
                  className="product-card-media"
                  href={`/products/${encodeURIComponent(product.id)}`}
                  aria-label={`View ${product.colorName} details`}
                >
                  <ProductImage
                    src={product.image}
                    alt={`${product.name} — ${product.colorName}`}
                    width={560}
                    height={700}
                  />
                  {product.availability ? (
                    <span className="product-tag">{product.availability}</span>
                  ) : null}
                </Link>

                <div className="product-card-info">
                  <h3 className="product-card-name">
                    <Link
                      className="product-card-link"
                      href={`/products/${encodeURIComponent(product.id)}`}
                    >
                      {product.name}
                    </Link>
                  </h3>
                  <p className="product-card-color">{product.colorName}</p>
                  <p className="product-card-price">
                    {formatThb(unitPriceThb)}
                  </p>
                  {sizeSurchargeThb > 0 ? (
                    <p className="price-note">
                      {formatThb(product.priceThb)} +{" "}
                      {formatThb(sizeSurchargeThb)} for {selectedSize}
                    </p>
                  ) : null}
                </div>

                <div className="product-card-sizes">
                  <div className="size-field">
                    <div className="size-field-head">
                      <span
                        className="size-field-label"
                        id={`size-label-${product.id}`}
                      >
                        Size
                      </span>
                      <span className="size-field-value">{selectedSize}</span>
                    </div>
                    <div
                      className="size-list"
                      role="group"
                      aria-labelledby={`size-label-${product.id}`}
                    >
                      {product.availableSizes.map((size) => {
                        const surcharge = getSizeSurchargeThb(size);

                        return (
                          <button
                            key={size}
                            type="button"
                            className={`size-opt${selectedSize === size ? " is-selected" : ""
                              }`}
                            aria-pressed={selectedSize === size}
                            aria-label={
                              surcharge > 0
                                ? `Size ${size}, plus ${surcharge} THB`
                                : `Size ${size}`
                            }
                            onClick={() => onChoiceChange(product.id, { size })}
                          >
                            <span aria-hidden="true">{size}</span>
                            {surcharge > 0 ? (
                              <span className="size-opt-fee" aria-hidden="true">
                                +{surcharge}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    {hasSurchargedSize ? (
                      <p className="size-note">
                        Size 3XL ขึ้นไปเพิ่มราคา {formatThb(SIZE_SURCHARGE_THB)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="product-card-action">
                  <QuantityStepper
                    value={quantity}
                    min={1}
                    label={`Quantity for ${product.name}`}
                    onChange={(next) =>
                      onChoiceChange(product.id, { quantity: next })
                    }
                  />
                  <button
                    className={`btn ${addedProductId === product.id
                      ? "btn-secondary"
                      : "btn-primary"
                      }`}
                    type="button"
                    onClick={() => handleAddProduct(product)}
                  >
                    {addedProductId === product.id ? "Added ✓" : "Add to cart"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Cart
   ════════════════════════════════════════════════════════════════ */
function CartSection({
  items,
  university,
  onQuantityChange,
  onRemove,
  onContinue,
  onShop
}: {
  items: CartItem[];
  university: University;
  onQuantityChange: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  onContinue: () => void;
  onShop: () => void;
}) {
  const subtotal = items.reduce(
    (total, item) => total + getCartItemSubtotal(item),
    0
  );

  return (
    <section className="step-section">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">{university.brand}</p>
          <h2 className="display-lg">Your <span className="serif-accent">Cart</span></h2>
          <p className="section-head-note">
            ตรวจสอบรายการสินค้าก่อนดำเนินการต่อ
          </p>
        </div>
        {items.length > 0 ? (
          <div className="section-head-actions">
            <button
              className="btn btn-secondary btn-sm is-thai"
              type="button"
              onClick={onShop}
            >
              เลือกสินค้าเพิ่ม
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="state is-thai">
          <span className="state-mark" aria-hidden="true">
            ○
          </span>
          <h3>ตะกร้าของคุณยังว่าง</h3>
          <p>เลือกดูคอลเลกชันแล้วเพิ่มเสื้อที่ถูกใจลงตะกร้าได้เลย</p>
          <button className="btn btn-primary is-thai" type="button" onClick={onShop}>
            เลือกดูสินค้า
          </button>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {items.map((item) => (
              <article className="cart-row" key={item.lineId}>
                <div className="cart-row-media">
                  <Link
                    href={`/products/${item.productId}`}
                    className="cart-row-media-link"
                    aria-label={`ดูรายละเอียดสินค้า ${item.productName} — ${item.colorName}`}
                  >
                    <ProductImage
                      src={item.image}
                      alt={`${item.productName} — ${item.colorName}`}
                      width={200}
                      height={240}
                    />
                  </Link>
                </div>

                <div className="cart-row-main">
                  <Link
                    href={`/products/${item.productId}`}
                    className="cart-row-name cart-row-link"
                  >
                    {item.productName}
                  </Link>
                  <span className="cart-row-meta">
                    {item.colorName} · ไซส์ {item.size}
                  </span>
                  <span className="cart-row-unit">
                    {formatThb(item.unitPriceThb)} ต่อชิ้น
                    {item.sizeSurchargeThb > 0 ? (
                      <span className="cart-row-fee">
                        {formatThb(item.basePriceThb)} +{" "}
                        {formatThb(item.sizeSurchargeThb)} (ไซส์ {item.size})
                      </span>
                    ) : null}
                  </span>
                </div>

                <button
                  className="icon-btn cart-row-remove"
                  type="button"
                  onClick={() => onRemove(item.lineId)}
                  aria-label={`ลบ ${item.productName} ไซส์ ${item.size} ออกจากตะกร้า`}
                >
                  ×
                </button>

                <div className="cart-row-foot">
                  <QuantityStepper
                    value={item.quantity}
                    min={1}
                    label={`จำนวนของ ${item.productName} ไซส์ ${item.size}`}
                    onChange={(next) => onQuantityChange(item.lineId, next)}
                  />
                  <span className="cart-row-total">
                    {formatThb(getCartItemSubtotal(item))}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <div className="summary">
            <h3 className="summary-title">สรุปตะกร้า</h3>
            <dl>
              <div className="summary-row">
                <dt>จำนวนสินค้า</dt>
                <dd>
                  {items.reduce((count, item) => count + item.quantity, 0)} ชิ้น
                </dd>
              </div>
              <div className="summary-row is-total">
                <dt>ยอดรวมสินค้า</dt>
                <dd>{formatThb(subtotal)}</dd>
              </div>
            </dl>
            <p className="summary-note">
              {university.id === "bangmod"
                ? "เลือกวิธีรับสินค้าในขั้นตอนถัดไป · รับสินค้าด้วยตนเองไม่มีค่าจัดส่ง หรือจัดส่ง 50 THB (1–10 ตัว, เกินจากนั้น +10 THB ต่อตัว)"
                : "เลือกวิธีรับสินค้าในขั้นตอนถัดไป · ค่าจัดส่ง 50 THB (1–10 ตัว, เกินจากนั้น +10 THB ต่อตัว)"}
            </p>
          </div>

          <div className="action-bar">
            <div className="action-bar-inner">
              <dl className="action-bar-total is-thai">
                <dt>ยอดรวมสินค้า</dt>
                <dd>{formatThb(subtotal)}</dd>
              </dl>
              <div className="action-bar-row">
                <button
                  className="btn btn-primary is-thai"
                  type="button"
                  onClick={onContinue}
                >
                  ดำเนินการสั่งซื้อ
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Checkout
   ════════════════════════════════════════════════════════════════ */
function CheckoutSection({
  checkout,
  errors,
  items,
  totals,
  university,
  onChange,
  onContinue
}: {
  checkout: CheckoutDetails;
  errors: Record<string, string>;
  items: CartItem[];
  totals: ReturnType<typeof calculateOrderTotals>;
  university: University;
  onChange: (checkout: CheckoutDetails) => void;
  onContinue: () => void;
}) {
  const availableDeliveryMethods = getAvailableDeliveryMethods(university.id);
  const totalItemCount = getCartTotalQuantity(items);
  const shippingFeePreview = getShippingFee("shipping", totalItemCount);

  return (
    <section className="step-section">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">{university.brand}</p>
          <h2 className="display-lg">Your <span className="serif-accent">Details</span></h2>
          <p className="section-head-note">
            กรอกข้อมูลสำหรับติดต่อและการรับสินค้า
          </p>
        </div>
      </div>

      <div className="checkout-layout">
        <form
          className="checkout-main"
          id="checkout-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onContinue();
          }}
        >
          <div className="form-block">
            <h3 className="form-block-title">ข้อมูลติดต่อ</h3>

            <div className="field-grid">
              <div className="field">
                <label className="field-label" htmlFor="checkout-name">
                  ชื่อ-นามสกุล
                </label>
                <input
                  id="checkout-name"
                  className="field-input"
                  name="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  placeholder="กรอกชื่อและนามสกุล"
                  value={checkout.fullName}
                  onChange={(event) =>
                    onChange({ ...checkout, fullName: event.target.value })
                  }
                  aria-invalid={Boolean(errors.fullName)}
                  aria-describedby={
                    errors.fullName ? "checkout-name-error" : undefined
                  }
                />
                {errors.fullName ? (
                  <span className="field-error" id="checkout-name-error">
                    {errors.fullName}
                  </span>
                ) : null}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="checkout-phone">
                  เบอร์โทรศัพท์
                </label>
                <input
                  id="checkout-phone"
                  className="field-input"
                  name="tel"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  placeholder="08xxxxxxxx"
                  value={checkout.phone}
                  onChange={(event) =>
                    onChange({ ...checkout, phone: event.target.value })
                  }
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? "checkout-phone-error" : "checkout-phone-hint"
                  }
                />
                {errors.phone ? (
                  <span className="field-error" id="checkout-phone-error">
                    {errors.phone}
                  </span>
                ) : (
                  <span className="field-hint" id="checkout-phone-hint">
                    ใช้สำหรับติดต่อเรื่องการรับหรือจัดส่งสินค้า
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="form-block">
            <h3 className="form-block-title">วิธีรับสินค้า</h3>

            <fieldset>
              <legend className="vh">เลือกวิธีรับสินค้า</legend>
              <div className="choice-list">
                {availableDeliveryMethods.map((method) => {
                  const selected = checkout.deliveryMethod === method;

                  return (
                    <label
                      className={`choice${selected ? " is-selected" : ""}`}
                      key={method}
                    >
                      <input
                        checked={selected}
                        name="deliveryMethod"
                        type="radio"
                        value={method}
                        onChange={() =>
                          onChange({ ...checkout, deliveryMethod: method })
                        }
                      />
                      <span className="choice-mark" aria-hidden="true" />
                      <span className="choice-body">
                        <span className="choice-head">
                          <span className="choice-title">
                            {method === "pickup" ? "รับสินค้าด้วยตนเอง" : "จัดส่งพัสดุ"}
                          </span>
                          <span className="choice-price">
                            {method === "pickup"
                              ? "ไม่มีค่าจัดส่ง"
                              : `+${formatThb(shippingFeePreview)}`}
                          </span>
                        </span>
                        <span className="choice-desc">
                          {method === "pickup"
                            ? `รับสินค้าด้วยตนเองที่ ${university.shortName}`
                            : "จัดส่งพัสดุ หากเกิน10ตัวจะมีการ +10 THB ต่อตัว"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {errors.deliveryMethod ? (
              <span className="field-error" id="checkout-delivery-error">
                {errors.deliveryMethod}
              </span>
            ) : null}

            {checkout.deliveryMethod === "shipping" ? (
              <div className="field">
                <label className="field-label" htmlFor="checkout-address">
                  ที่อยู่สำหรับจัดส่ง
                </label>
                <textarea
                  id="checkout-address"
                  className="field-textarea"
                  name="street-address"
                  autoComplete="street-address"
                  enterKeyHint="done"
                  rows={4}
                  value={checkout.shippingAddress}
                  onChange={(event) =>
                    onChange({ ...checkout, shippingAddress: event.target.value })
                  }
                  aria-invalid={Boolean(errors.shippingAddress)}
                  aria-describedby={
                    errors.shippingAddress ? "checkout-address-error" : undefined
                  }
                  placeholder={"บ้านเลขที่, ซอย/ถนน, แขวง/ตำบล\nเขต/อำเภอ, จังหวัด, รหัสไปรษณีย์"}
                />
                {/* aria-describedby above names this id, so it must exist
                    whenever the field is invalid. */}
                {errors.shippingAddress ? (
                  <span className="field-error" id="checkout-address-error">
                    {errors.shippingAddress}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </form>

        <aside className="checkout-aside" aria-label="สรุปยอดคำสั่งซื้อ">
          <TotalsSummary totals={totals} />
        </aside>
      </div>

      <div className="action-bar">
        <div className="action-bar-inner">
          <dl className="action-bar-total is-thai">
            <dt>ยอดรวมทั้งหมด</dt>
            <dd>{formatThb(totals.finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-primary is-thai"
              type="submit"
              form="checkout-form"
            >
              ดำเนินการต่อ
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Payment
   ════════════════════════════════════════════════════════════════ */
function PaymentSection({
  finalTotalThb,
  slipFile,
  slipPreviewUrl,
  slipError,
  slipOptimizing,
  slipSavedFromBytes,
  onSlipChange,
  onBack,
  onContinue
}: {
  finalTotalThb: number;
  slipFile: File | null;
  slipPreviewUrl: string;
  slipError: string;
  slipOptimizing: boolean;
  slipSavedFromBytes: number;
  onSlipChange: (file: File | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="step-section">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">Payment</p>
          <h2 className="display-lg">Transfer &amp; <span className="serif-accent">Upload</span></h2>
          <p className="section-head-note">
            โอนเงินตามยอดด้านล่าง แล้วอัปโหลดสลิปเพื่อยืนยัน
          </p>
        </div>
      </div>

      <dl className="pay-amount">
        <dt>ยอดที่ต้องชำระ</dt>
        <dd>{formatThb(finalTotalThb)}</dd>
      </dl>

      <div className="pay-grid">
        <div className="qr-block">
          <div className="qr-card">
            <Image
              src="/payment/promptpay-qr.jpg"
              alt="Thai QR PromptPay code for Tripleo.bkk. Accepts all banks."
              width={885}
              height={1200}
              priority
              // Served as-is: re-encoding a QR can cost it scan reliability.
              unoptimized
            />
          </div>
          <p className="qr-payee">
            <span className="vh">ชื่อบัญชี: </span>
            นาย กรวิวัฒน์ แจ้งกระจ่าง · xxx-x-x1113-x
          </p>
          <a
            className="qr-save"
            href="/payment/promptpay-qr.jpg"
            target="_blank"
            rel="noopener noreferrer"
          >
            เปิดรูปขนาดเต็มเพื่อบันทึก
          </a>
          <p className="qr-note">
            สแกน QR Code เพื่อชำระเงินด้วยแอปธนาคารใดก็ได้ หรือบันทึกรูปนี้ไว้
            แล้วใช้เมนูสแกนจากคลังภาพในแอปธนาคารของคุณ
          </p>
        </div>

        <div>
          <h3 className="pay-steps-title">วิธีชำระเงิน</h3>
          <ol className="pay-steps">
            <li>สแกน QR Code แล้วโอนเงินยอด {formatThb(finalTotalThb)}</li>
            <li>บันทึกภาพสลิปยืนยันการโอนเงิน</li>
            <li>อัปโหลดสลิปด้านล่างนี้</li>
            <li>ตรวจสอบและยืนยันคำสั่งซื้อ</li>
          </ol>
          <p className="pay-disclaimer">
            การอัปโหลดสลิปยังไม่ถือว่าชำระเงินสำเร็จ
            ทีมงานจะตรวจสอบสลิปทุกใบด้วยตนเองก่อนดำเนินการ
            กรุณาเก็บภาพสลิปต้นฉบับไว้จนกว่าคำสั่งซื้อจะได้รับการยืนยัน
          </p>
        </div>
      </div>

      <div className="upload-block">
        <h3 className="pay-steps-title">สลิปการชำระเงิน</h3>

        <label
          className={`upload${slipFile ? " has-file" : ""}${slipOptimizing ? " is-busy" : ""
            }`}
        >
          {slipOptimizing ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="upload-title">กำลังเตรียมสลิป…</span>
              <span className="upload-hint">
                ย่อขนาดรูปเพื่อให้อัปโหลดได้เร็วขึ้น
              </span>
            </>
          ) : slipFile ? (
            <>
              <span className="upload-thumb">
                {slipPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slipPreviewUrl} alt="ตัวอย่างสลิปการชำระเงิน" />
                ) : null}
              </span>
              <span className="upload-meta">
                <span className="upload-filename">
                  เลือกสลิปเรียบร้อยแล้ว · {slipFile.name}
                </span>
                <span className="upload-sub">
                  {slipSavedFromBytes > 0
                    ? `${formatBytes(slipSavedFromBytes)} → ${formatBytes(slipFile.size)} · แตะเพื่อเปลี่ยนสลิป`
                    : `${formatBytes(slipFile.size)} · แตะเพื่อเปลี่ยนสลิป`}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="upload-mark" aria-hidden="true">
                ↑
              </span>
              <span className="upload-title">อัปโหลดสลิปการชำระเงิน</span>
              <span className="upload-hint">
                แตะเพื่อเลือกรูปสลิป · JPG, PNG หรือ WEBP · ไม่เกิน 5 MB
              </span>
            </>
          )}
          <input
            accept={acceptedSlipMimeTypes.join(",")}
            type="file"
            disabled={slipOptimizing}
            onChange={(event) => {
              onSlipChange(event.target.files?.item(0) ?? null);
              // Allow re-picking the same file after a validation error.
              event.target.value = "";
            }}
          />
        </label>

        {slipFile ? (
          <div className="upload-actions">
            <button
              className="btn btn-quiet is-thai"
              type="button"
              onClick={() => onSlipChange(null)}
            >
              ลบสลิป
            </button>
          </div>
        ) : null}

        {slipError ? (
          <p className="form-alert" role="alert">
            {slipError}
          </p>
        ) : null}
      </div>

      <div className="action-bar">
        <div className="action-bar-inner">
          <dl className="action-bar-total is-thai">
            <dt>ยอดที่ต้องชำระ</dt>
            <dd>{formatThb(finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-secondary is-thai"
              type="button"
              onClick={onBack}
            >
              ย้อนกลับ
            </button>
            <button
              className="btn btn-primary is-thai"
              disabled={!slipFile || slipOptimizing}
              type="button"
              onClick={onContinue}
            >
              ตรวจสอบคำสั่งซื้อ
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Review
   ════════════════════════════════════════════════════════════════ */
function ReviewSection({
  checkout,
  isSubmitting,
  items,
  submissionError,
  slipFile,
  slipPreviewUrl,
  submitStage,
  uploadPercent,
  totals,
  university,
  onBack,
  onConfirm
}: {
  checkout: CheckoutDetails;
  isSubmitting: boolean;
  items: CartItem[];
  submissionError: string;
  slipFile: File | null;
  slipPreviewUrl: string;
  submitStage: SubmitStage;
  uploadPercent: number;
  totals: ReturnType<typeof calculateOrderTotals>;
  university: University;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="step-section">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">{university.brand}</p>
          <h2 className="display-lg">Review <span className="serif-accent">Order</span></h2>
          <p className="section-head-note">
            ตรวจสอบข้อมูลทั้งหมดก่อนยืนยันคำสั่งซื้อ
          </p>
        </div>
      </div>

      <OrderItemsPanel items={items} />

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">ข้อมูลผู้สั่งซื้อ</span>
        </div>
        <dl className="panel-body">
          <div className="kv">
            <dt>ชื่อ-นามสกุล</dt>
            <dd>{checkout.fullName}</dd>
          </div>
          <div className="kv">
            <dt>เบอร์โทรศัพท์</dt>
            <dd>{checkout.phone}</dd>
          </div>
          <div className="kv">
            <dt>มหาวิทยาลัย</dt>
            <dd>{university.shortName}</dd>
          </div>
          <div className="kv">
            <dt>วิธีรับสินค้า</dt>
            <dd>
              {checkout.deliveryMethod === "pickup"
                ? `รับสินค้าด้วยตนเอง · ${university.shortName}`
                : "จัดส่ง"}
            </dd>
          </div>
          {/* A pickup order has no address to show. */}
          {checkout.deliveryMethod === "shipping" ? (
            <div className="kv">
              <dt>ที่อยู่สำหรับจัดส่ง</dt>
              <dd>{checkout.shippingAddress}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">สลิปการชำระเงิน</span>
        </div>
        <div className="slip-proof">
          {slipPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slipPreviewUrl} alt="สลิปการชำระเงินที่คุณอัปโหลด" />
          ) : null}
          <span className="upload-meta">
            <span className="upload-filename">
              {slipFile ? slipFile.name : "ยังไม่ได้แนบสลิป"}
            </span>
            <span className="upload-sub">
              {slipFile
                ? `เลือกสลิปเรียบร้อยแล้ว · ${formatBytes(slipFile.size)}`
                : "กรุณาย้อนกลับไปอัปโหลดสลิปก่อน"}
            </span>
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">ยอดรวมทั้งหมด</span>
        </div>
        <dl className="panel-body">
          <div className="kv">
            <dt>ยอดรวมสินค้า</dt>
            <dd>{formatThb(totals.itemSubtotalThb)}</dd>
          </div>
          <div className="kv">
            <dt>ค่าจัดส่ง</dt>
            <dd>{formatThb(totals.shippingFeeThb)}</dd>
          </div>
          <div className="kv">
            <dt>
              <strong>ยอดที่ต้องชำระ</strong>
            </dt>
            <dd>
              <strong>{formatThb(totals.finalTotalThb)}</strong>
            </dd>
          </div>
        </dl>
      </div>

      <p className="review-note">
        เมื่อกดยืนยัน ระบบจะบันทึกคำสั่งซื้อของคุณ
        ทีมงานจะตรวจสอบสลิปการชำระเงิน โดยลูกค้าสามารถตรวจสอบสถานะได้ที่ระบบติดตามคำสั่งซื้อ
      </p>

      {submissionError ? (
        <p className="form-alert" role="alert" style={{ marginTop: "var(--s-4)" }}>
          {submissionError}
        </p>
      ) : null}

      {submitStage !== "idle" ? (
        <div className="submit-status" role="status" aria-live="polite">
          <div className="submit-status-head">
            <span className="submit-status-label">
              {submitStageLabels[submitStage]}…
            </span>
            {submitStage === "uploading" ? (
              <span className="submit-status-percent">{uploadPercent}%</span>
            ) : null}
          </div>
          <div
            className="submit-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={submitStage === "uploading" ? uploadPercent : undefined}
          >
            <span
              className={`submit-progress-fill${submitStage === "confirming" ? " is-indeterminate" : ""
                }`}
              style={
                submitStage === "uploading"
                  ? { width: `${uploadPercent}%` }
                  : undefined
              }
            />
          </div>
          <p className="submit-status-note">
            กรุณาเปิดหน้านี้ค้างไว้ อย่าปิดหรือรีเฟรชหน้าจอ
          </p>
        </div>
      ) : null}

      <div className="action-bar">
        <div className="action-bar-inner">
          <dl className="action-bar-total is-thai">
            <dt>ยอดรวมทั้งหมด</dt>
            <dd>{formatThb(totals.finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-secondary is-thai"
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
            >
              ย้อนกลับ
            </button>
            <button
              className="btn btn-primary is-thai"
              disabled={!slipFile || isSubmitting}
              aria-busy={isSubmitting}
              type="button"
              onClick={onConfirm}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {submitStage === "confirming"
                    ? "กำลังยืนยัน"
                    : "กำลังส่ง"}
                </>
              ) : (
                "ยืนยันคำสั่งซื้อ"
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Success
   ════════════════════════════════════════════════════════════════ */
function SuccessSection({
  order,
  onReset
}: {
  order: ConfirmedOrder;
  onReset: () => void;
}) {
  const university = getUniversityById(order.universityId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyOrderId() {
    try {
      await navigator.clipboard.writeText(order.orderId);
      setCopied(true);
    } catch {
      // Clipboard access can be denied — the ID stays visible on screen.
    }
  }

  return (
    <section className="step-section">
      <div className="done">
        <span className="done-mark" aria-hidden="true">
          ✓
        </span>
        <h2 className="display-lg">Order <span className="serif-accent">Placed</span></h2>
        <p className="lede">
          สั่งซื้อสำเร็จ เราได้รับคำสั่งซื้อของคุณแล้ว
        </p>

        <p className="order-id-label">หมายเลขคำสั่งซื้อ</p>
        <div className="order-id" role="status">
          <span className="order-id-value">{order.orderId}</span>
          <button
            className="btn btn-secondary btn-sm is-thai"
            type="button"
            onClick={copyOrderId}
          >
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </button>
        </div>

        <div className="done-next">
          <h3>ข้อมูลคำสั่งซื้อ</h3>
          <p>
            สถานะการชำระเงิน:{" "}
            <strong>{paymentStatusLabels[order.paymentStatus]}</strong>
          </p>
          <p>
            ทีมงานจะตรวจสอบสลิปการชำระเงินของคุณด้วยตนเอง
          </p>
          <p>
            {university?.brand} ·{" "}
            {order.checkout.deliveryMethod === "pickup"
              ? `รับสินค้าด้วยตนเอง · ${university?.shortName ?? ""}`
              : "จัดส่ง"}
          </p>
        </div>

        <div className="done-panel">
          <OrderItemsPanel items={order.items} />

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">ยอดรวมทั้งหมด</span>
            </div>
            <dl className="panel-body">
              <div className="kv">
                <dt>ยอดรวมสินค้า</dt>
                <dd>{formatThb(order.itemSubtotalThb)}</dd>
              </div>
              <div className="kv">
                <dt>ค่าจัดส่ง</dt>
                <dd>{formatThb(order.shippingFeeThb)}</dd>
              </div>
              <div className="kv">
                <dt>
                  <strong>ยอดที่ชำระ</strong>
                </dt>
                <dd>
                  <strong>{formatThb(order.finalTotalThb)}</strong>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <Link
          className="btn btn-primary btn-block is-thai"
          href="/tracking"
          style={{ marginTop: "var(--s-4)" }}
        >
          ติดตามคำสั่งซื้อ
        </Link>

        <button
          className="btn btn-secondary btn-block is-thai"
          type="button"
          onClick={onReset}
          style={{ marginTop: "var(--s-3)" }}
        >
          สั่งซื้อรายการใหม่
        </button>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Shared pieces
   ════════════════════════════════════════════════════════════════ */
function OrderItemsPanel({ items }: { items: CartItem[] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">รายการสินค้า</span>
        <span className="panel-title">
          {items.reduce((count, item) => count + item.quantity, 0)} ชิ้น
        </span>
      </div>
      {items.map((item) => (
        <div className="line-item" key={item.lineId}>
          <div className="line-item-media">
            <ProductImage
              src={item.image}
              alt={item.productName}
              width={120}
              height={144}
            />
          </div>
          <div className="line-item-text">
            <div className="line-item-name">{item.productName}</div>
            <div className="line-item-meta">
              {item.colorName} · ไซส์ {item.size} · {formatThb(item.unitPriceThb)}{" "}
              × {item.quantity} ชิ้น
              {item.sizeSurchargeThb > 0
                ? ` · รวมค่าไซส์ ${formatThb(item.sizeSurchargeThb)} ต่อตัว`
                : ""}
            </div>
          </div>
          <div className="line-item-total">
            {formatThb(getCartItemSubtotal(item))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TotalsSummary({
  totals
}: {
  totals: ReturnType<typeof calculateOrderTotals>;
}) {
  return (
    <div className="summary">
      <h3 className="summary-title">สรุปคำสั่งซื้อ</h3>
      <dl>
        <div className="summary-row">
          <dt>ยอดรวมสินค้า</dt>
          <dd>{formatThb(totals.itemSubtotalThb)}</dd>
        </div>
        <div className="summary-row">
          <dt>ค่าจัดส่ง</dt>
          <dd>{formatThb(totals.shippingFeeThb)}</dd>
        </div>
        <div className="summary-row is-total">
          <dt>ยอดรวมทั้งหมด</dt>
          <dd>{formatThb(totals.finalTotalThb)}</dd>
        </div>
      </dl>
    </div>
  );
}

function QuantityStepper({
  value,
  min,
  label,
  onChange
}: {
  value: number;
  min: number;
  label: string;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="qty">
      <button
        className="qty-btn"
        type="button"
        disabled={value <= min}
        onClick={() => onChange(clampQuantity(value - 1, min))}
        aria-label="ลดจำนวน"
      >
        −
      </button>
      <input
        className="qty-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={MAX_LINE_QUANTITY}
        step={1}
        value={value}
        onChange={(event) => {
          if (event.target.value === "") {
            return;
          }

          onChange(clampQuantity(Number(event.target.value), min));
        }}
        aria-label={label}
      />
      <button
        className="qty-btn"
        type="button"
        disabled={value >= MAX_LINE_QUANTITY}
        onClick={() => onChange(clampQuantity(value + 1, min))}
        aria-label="เพิ่มจำนวน"
      >
        +
      </button>
    </div>
  );
}

function ProductImage({
  src,
  alt,
  width,
  height
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const [resolvedSrc, setResolvedSrc] = useState(src || productImagePlaceholder);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => setResolvedSrc(productImagePlaceholder)}
    />
  );
}

function clampQuantity(quantity: number, min: number) {
  if (!Number.isFinite(quantity)) {
    return min;
  }

  return Math.min(MAX_LINE_QUANTITY, Math.max(min, Math.floor(quantity)));
}

/**
 * Posts the order over XHR rather than fetch purely so the upload can report
 * real byte progress — on mobile the slip upload is most of the wait, and a
 * moving bar is the difference between "working" and "frozen". Same-origin
 * POST still sends the Origin header the API requires.
 */
function postOrder(
  formData: FormData,
  onUploadProgress: (percent: number) => void
): Promise<OrderSubmissionResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/orders");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onUploadProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100))
        );
      }
    };
    xhr.upload.onload = () => onUploadProgress(100);

    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as OrderSubmissionResult);
      } catch {
        reject(new Error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"));
      }
    };
    xhr.onerror = () => reject(new Error("Order submission failed."));
    xhr.ontimeout = () => reject(new Error("Order submission timed out."));

    xhr.send(formData);
  });
}

function focusFirstInvalidField() {
  // Errors are painted on the next render, so wait for it before looking.
  window.requestAnimationFrame(() => {
    const invalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.scrollIntoView({ block: "center", behavior: "smooth" });
    invalid?.focus({ preventScroll: true });
  });
}

function canOpenStep(
  nextStep: Step,
  items: CartItem[],
  checkout?: CheckoutDetails,
  slipFile?: File | null
) {
  if (nextStep === "shop" || nextStep === "cart") {
    return true;
  }

  if (nextStep === "checkout") {
    return items.length > 0;
  }

  const isDetailsComplete =
    items.length > 0 &&
    Boolean(checkout?.fullName.trim()) &&
    Boolean(checkout?.phone.trim()) &&
    (checkout?.deliveryMethod !== "shipping" ||
      Boolean(checkout?.shippingAddress.trim()));

  if (nextStep === "payment") {
    return isDetailsComplete;
  }

  if (nextStep === "review") {
    return isDetailsComplete && Boolean(slipFile);
  }

  return true;
}

function createSubmissionKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
