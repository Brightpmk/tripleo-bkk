"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAvailableDeliveryMethods,
  getProductsForUniversity,
  getUniversityById,
  isDeliveryMethodAllowed,
  productImagePlaceholder,
  universities,
  type ShirtSize,
  type Product,
  type University,
  type UniversityId
} from "@/lib/catalog";
import {
  addCartItem,
  getCartItemSubtotal,
  getCartTotalQuantity,
  removeCartItem,
  updateCartQuantity,
  type CartItem
} from "@/lib/cart";
import { formatThb } from "@/lib/format";
import {
  type CheckoutDetails,
  type ConfirmedOrder
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

type Step = "select" | "shop" | "cart" | "checkout" | "payment" | "review" | "success";

type ProductChoice = {
  size: ShirtSize;
  quantity: number;
};

type StorefrontAppProps = {
  initialProducts: Product[];
  catalogError?: string;
};

const MAX_LINE_QUANTITY = 20;

type SubmitStage = "idle" | "uploading" | "confirming";

const submitStageLabels: Record<Exclude<SubmitStage, "idle">, string> = {
  uploading: "Sending your payment slip",
  confirming: "Confirming your order"
};

const defaultCheckout: CheckoutDetails = {
  fullName: "",
  phone: "",
  deliveryMethod: "pickup",
  shippingAddress: ""
};

const stepLabels: Record<Step, string> = {
  select: "University",
  shop: "Shop",
  cart: "Cart",
  checkout: "Details",
  payment: "Payment",
  review: "Review",
  success: "Done"
};

const checkoutSteps: Step[] = [
  "select",
  "shop",
  "cart",
  "checkout",
  "payment",
  "review"
];

export function StorefrontApp({
  initialProducts,
  catalogError = ""
}: StorefrontAppProps) {
  const [selectedUniversityId, setSelectedUniversityId] =
    useState<UniversityId | null>(null);
  const [step, setStep] = useState<Step>("select");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
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
  const [checkout, setCheckout] =
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

  const selectedUniversity = selectedUniversityId
    ? getUniversityById(selectedUniversityId)
    : null;
  const availableProducts = selectedUniversityId
    ? getProductsForUniversity(initialProducts, selectedUniversityId)
    : [];
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

  function selectUniversity(universityId: UniversityId) {
    if (selectedUniversityId && selectedUniversityId !== universityId) {
      setCartItems([]);
      setSlip(null);
      setOrder(null);
      setSubmissionError("");
      setSubmissionKey(createSubmissionKey());
    }

    const allowedMethods = getAvailableDeliveryMethods(universityId);
    if (!allowedMethods.includes(checkout.deliveryMethod)) {
      setCheckout((current) => ({
        ...current,
        deliveryMethod: allowedMethods[0]
      }));
    }

    setSelectedUniversityId(universityId);
    setStep("shop");
    window.history.replaceState(null, "", `#shop-${universityId}`);
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
    if (!selectedUniversityId) {
      return;
    }

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
        universityId: selectedUniversityId,
        size: selectedSize,
        quantity: choice.quantity
      })
    );
    setStep("cart");
  }

  function validateCheckout() {
    const nextErrors: Record<string, string> = {};

    if (!checkout.fullName.trim()) {
      nextErrors.fullName = "Full name is required.";
    }

    if (!checkout.phone.trim()) {
      nextErrors.phone = "Phone number is required.";
    }

    if (
      selectedUniversityId &&
      !isDeliveryMethodAllowed(selectedUniversityId, checkout.deliveryMethod)
    ) {
      nextErrors.deliveryMethod =
        selectedUniversityId === "bangmod"
          ? "Select pickup or shipping."
          : "Delivery is the only available option for this university.";
    }

    if (
      checkout.deliveryMethod === "shipping" &&
      !checkout.shippingAddress.trim()
    ) {
      nextErrors.shippingAddress = "Shipping address is required.";
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
    if (!selectedUniversityId || !slipFile || cartItems.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitStage("uploading");
    setUploadPercent(0);
    setSubmissionError("");

    try {
      const orderPayload = {
        universityId: selectedUniversityId,
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
      setSubmissionError(
        "We could not save your order right now. Please try again in a moment."
      );
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
    setStep(selectedUniversityId ? "shop" : "select");
  }

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-left">
          <button
            className="wordmark"
            type="button"
            onClick={() => setStep("select")}
          >
            Tripleo.bkk
          </button>
          {selectedUniversity ? (
            <span className="uni-tag" title={selectedUniversity.fullName}>
              <span className="uni-dot" aria-hidden="true" />
              {selectedUniversity.brand}
            </span>
          ) : null}
        </div>

        <div className="header-right">
          <Link className="track-nav-btn" href="/tracking">
            Track order
          </Link>
          <button
            className="cart-btn"
            type="button"
            onClick={() => setStep(cartItems.length > 0 ? "cart" : "shop")}
            disabled={!selectedUniversityId}
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
        </div>
      </header>

      {step === "select" ? (
        <UniversitySection onSelect={selectUniversity} />
      ) : (
        <div className="content-container">
          {selectedUniversity && step !== "success" ? (
            <StepProgress
              step={step}
              cartItems={cartItems}
              universityId={selectedUniversityId}
              onNavigate={setStep}
            />
          ) : null}

          {step === "shop" && selectedUniversity ? (
            <ShopSection
              catalogError={catalogError}
              products={availableProducts}
              university={selectedUniversity}
              choices={choices}
              onChoiceChange={updateChoice}
              onAddProduct={addProduct}
            />
          ) : null}

          {step === "cart" && selectedUniversity ? (
            <CartSection
              items={cartItems}
              university={selectedUniversity}
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

          {step === "checkout" && selectedUniversity ? (
            <CheckoutSection
              checkout={checkout}
              errors={formErrors}
              items={cartItems}
              totals={totals}
              university={selectedUniversity}
              onChange={setCheckout}
              onContinue={continueToPayment}
            />
          ) : null}

          {step === "payment" && selectedUniversity ? (
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

          {step === "review" && selectedUniversity ? (
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
              university={selectedUniversity}
              onBack={() => setStep("payment")}
              onConfirm={confirmOrder}
            />
          ) : null}

          {step === "success" && order ? (
            <SuccessSection order={order} onReset={resetOrder} />
          ) : null}
        </div>
      )}

      <footer className="site-footer">
        <span className="site-footer-brand">Tripleo.bkk</span>
        <span className="site-footer-note">
          Premium university streetwear · Bangkok
        </span>
      </footer>
    </main>
  );
}

/* ════════════════════════════════════════════════════════════════
   University selection
   ════════════════════════════════════════════════════════════════ */
function UniversitySection({
  onSelect
}: {
  onSelect: (universityId: UniversityId) => void;
}) {
  return (
    <section className="landing" id="universities">
      <div className="landing-inner">
        <div className="landing-head">
          <p className="eyebrow">Tripleo.bkk</p>
          <h1 className="display-xl">
            Select your
            <br />
            university
          </h1>
          <p className="lede">
            Limited shirt drops for eight Thai universities. Choose your
            university to see what&apos;s in stock.
          </p>
        </div>

        <div className="landing-rule" />
        <p className="eyebrow" id="university-list-label">
          {universities.length} university collections
        </p>

        <div
          className="uni-list"
          role="group"
          aria-labelledby="university-list-label"
        >
          {universities.map((university) => (
            <button
              className="uni-card"
              key={university.id}
              onClick={() => onSelect(university.id)}
              type="button"
              aria-label={`${university.brand} — ${university.fullName}`}
            >
              <span className="uni-card-text">
                <span className="uni-card-brand">{university.brand}</span>
                <span className="uni-card-uni">{university.shortName}</span>
              </span>
              <span className="uni-card-go" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Progress rail
   ════════════════════════════════════════════════════════════════ */
function StepProgress({
  step,
  cartItems,
  universityId,
  onNavigate
}: {
  step: Step;
  cartItems: CartItem[];
  universityId: UniversityId | null;
  onNavigate: (step: Step) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const currentIndex = Math.max(0, checkoutSteps.indexOf(step));

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
        {checkoutSteps.map((checkoutStep) => (
          <button
            className="progress-step"
            aria-current={step === checkoutStep ? "step" : undefined}
            disabled={!canOpenStep(checkoutStep, cartItems, universityId)}
            key={checkoutStep}
            onClick={() => onNavigate(checkoutStep)}
            type="button"
          >
            {stepLabels[checkoutStep]}
          </button>
        ))}
      </div>
      <div className="progress-track">
        <span
          className="progress-fill"
          style={{
            width: `${((currentIndex + 1) / checkoutSteps.length) * 100}%`
          }}
        />
      </div>
      <p className="progress-count">
        Step {currentIndex + 1} of {checkoutSteps.length} · {stepLabels[step]}
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
  return (
    <section className="step-section" id="shop">
      <div className="section-head">
        <div className="section-head-text">
          <p className="eyebrow">{university.brand}</p>
          <h2 className="display-lg">The Collection</h2>
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
                <div className="product-card-media">
                  <ProductImage
                    src={product.image}
                    alt={`${product.name} — ${product.colorName}`}
                    width={560}
                    height={700}
                  />
                  {product.availability ? (
                    <span className="product-tag">{product.availability}</span>
                  ) : null}
                </div>

                <div className="product-card-info">
                  <h3 className="product-card-name">{product.name}</h3>
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
                        3XL and above add {formatThb(SIZE_SURCHARGE_THB)} per
                        shirt.
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
                    className="btn btn-primary"
                    type="button"
                    onClick={() => onAddProduct(product)}
                  >
                    Add to cart
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
          <h2 className="display-lg">Your Cart</h2>
        </div>
        {items.length > 0 ? (
          <div className="section-head-actions">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onShop}
            >
              Add more items
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="state">
          <span className="state-mark" aria-hidden="true">
            ○
          </span>
          <h3>Your cart is empty</h3>
          <p>Browse the collection and add a shirt to get started.</p>
          <button className="btn btn-primary" type="button" onClick={onShop}>
            Browse shirts
          </button>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {items.map((item) => (
              <article className="cart-row" key={item.lineId}>
                <div className="cart-row-media">
                  <ProductImage
                    src={item.image}
                    alt={`${item.productName} — ${item.colorName}`}
                    width={200}
                    height={240}
                  />
                </div>

                <div className="cart-row-main">
                  <span className="cart-row-name">{item.productName}</span>
                  <span className="cart-row-meta">
                    {item.colorName} · Size {item.size}
                  </span>
                  <span className="cart-row-unit">
                    {formatThb(item.unitPriceThb)} each
                    {item.sizeSurchargeThb > 0 ? (
                      <span className="cart-row-fee">
                        {formatThb(item.basePriceThb)} +{" "}
                        {formatThb(item.sizeSurchargeThb)} size {item.size}
                      </span>
                    ) : null}
                  </span>
                </div>

                <button
                  className="icon-btn cart-row-remove"
                  type="button"
                  onClick={() => onRemove(item.lineId)}
                  aria-label={`Remove ${item.productName}, size ${item.size}, from cart`}
                >
                  ×
                </button>

                <div className="cart-row-foot">
                  <QuantityStepper
                    value={item.quantity}
                    min={1}
                    label={`Quantity of ${item.productName}, size ${item.size}`}
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
            <h3 className="summary-title">Cart summary</h3>
            <dl>
              <div className="summary-row">
                <dt>Items</dt>
                <dd>{items.reduce((count, item) => count + item.quantity, 0)}</dd>
              </div>
              <div className="summary-row is-total">
                <dt>Subtotal</dt>
                <dd>{formatThb(subtotal)}</dd>
              </div>
            </dl>
            <p className="summary-note">
              {university.id === "bangmod"
                ? "Delivery is chosen on the next step. Pickup is free, or shipping is 50 THB (1–10 shirts, +10 THB per extra shirt)."
                : "Delivery is chosen on the next step. Shipping is 50 THB (1–10 shirts, +10 THB per extra shirt)."}
            </p>
          </div>

          <div className="action-bar">
            <div className="action-bar-inner">
              <dl className="action-bar-total">
                <dt>Subtotal</dt>
                <dd>{formatThb(subtotal)}</dd>
              </dl>
              <div className="action-bar-row">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={onContinue}
                >
                  Checkout
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
          <h2 className="display-lg">Your Details</h2>
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
            <h3 className="form-block-title">Contact</h3>

            <div className="field-grid">
              <div className="field">
                <label className="field-label" htmlFor="checkout-name">
                  Full name
                </label>
                <input
                  id="checkout-name"
                  className="field-input"
                  name="name"
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  placeholder="e.g. Nattapong S."
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
                  Phone number
                </label>
                <input
                  id="checkout-phone"
                  className="field-input"
                  name="tel"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  placeholder="08X XXX XXXX"
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
                    We use this to reach you about pickup or delivery.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="form-block">
            <h3 className="form-block-title">Delivery</h3>

            <fieldset>
              <legend className="vh">Choose a delivery method</legend>
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
                            {method === "pickup" ? "University pickup" : "Shipping"}
                          </span>
                          <span className="choice-price">
                            {method === "pickup"
                              ? "Free"
                              : `+${formatThb(shippingFeePreview)}`}
                          </span>
                        </span>
                        <span className="choice-desc">
                          {method === "pickup"
                            ? `Collect at ${university.shortName}.`
                            : "Delivered to your address (50 THB for 1–10 shirts, +10 THB per extra shirt)."}
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
                  Shipping address
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
                    errors.shippingAddress
                      ? "checkout-address-error"
                      : "checkout-address-hint"
                  }
                  placeholder={"House no., street, sub-district\nDistrict, province, postcode"}
                />
                {errors.shippingAddress ? (
                  <span className="field-error" id="checkout-address-error">
                    {errors.shippingAddress}
                  </span>
                ) : (
                  <span className="field-hint" id="checkout-address-hint">
                    Include the postcode so delivery isn&apos;t delayed.
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </form>

        <aside className="checkout-aside" aria-label="Order totals">
          <TotalsSummary totals={totals} />
        </aside>
      </div>

      <div className="action-bar">
        <div className="action-bar-inner">
          <dl className="action-bar-total">
            <dt>Total</dt>
            <dd>{formatThb(totals.finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-primary"
              type="submit"
              form="checkout-form"
            >
              Continue to payment
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
          <h2 className="display-lg">Transfer &amp; Upload</h2>
        </div>
      </div>

      <dl className="pay-amount">
        <dt>Amount due</dt>
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
            <span className="vh">Payee: </span>
            นาย กรวิวัฒน์ แจ้งกระจ่าง · xxx-x-x1113-x
          </p>
          <a
            className="qr-save"
            href="/payment/promptpay-qr.jpg"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full size to save
          </a>
          <p className="qr-note">
            Scan with any Thai banking app, or save this image and use your
            bank&apos;s scan-from-gallery option.
          </p>
        </div>

        <div>
          <h3 className="pay-steps-title">How to pay</h3>
          <ol className="pay-steps">
            <li>Transfer exactly {formatThb(finalTotalThb)} using the QR code.</li>
            <li>Save the transfer confirmation screenshot.</li>
            <li>Upload that slip below.</li>
            <li>Review and confirm your order.</li>
          </ol>
          <p className="pay-disclaimer">
            Staff verify every slip manually before an order is processed. Keep
            the original screenshot until your order is confirmed.
          </p>
        </div>
      </div>

      <div className="upload-block">
        <h3 className="pay-steps-title">Payment slip</h3>

        <label
          className={`upload${slipFile ? " has-file" : ""}${slipOptimizing ? " is-busy" : ""
            }`}
        >
          {slipOptimizing ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="upload-title">Preparing your slip…</span>
              <span className="upload-hint">This keeps checkout fast.</span>
            </>
          ) : slipFile ? (
            <>
              <span className="upload-thumb">
                {slipPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slipPreviewUrl} alt="Payment slip preview" />
                ) : null}
              </span>
              <span className="upload-meta">
                <span className="upload-filename">{slipFile.name}</span>
                <span className="upload-sub">
                  {slipSavedFromBytes > 0
                    ? `${formatBytes(slipSavedFromBytes)} → ${formatBytes(slipFile.size)} · Tap to choose another`
                    : `${formatBytes(slipFile.size)} · Tap to choose another`}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="upload-mark" aria-hidden="true">
                ↑
              </span>
              <span className="upload-title">Upload payment slip</span>
              <span className="upload-hint">JPG, PNG or WEBP · max 5 MB</span>
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
              className="btn btn-quiet"
              type="button"
              onClick={() => onSlipChange(null)}
            >
              Remove slip
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
          <dl className="action-bar-total">
            <dt>Amount due</dt>
            <dd>{formatThb(finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={onBack}
            >
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={!slipFile || slipOptimizing}
              type="button"
              onClick={onContinue}
            >
              Review order
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
          <h2 className="display-lg">Review Order</h2>
        </div>
      </div>

      <OrderItemsPanel items={items} />

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Delivery details</span>
        </div>
        <dl className="panel-body">
          <div className="kv">
            <dt>Name</dt>
            <dd>{checkout.fullName}</dd>
          </div>
          <div className="kv">
            <dt>Phone</dt>
            <dd>{checkout.phone}</dd>
          </div>
          <div className="kv">
            <dt>Method</dt>
            <dd>
              {checkout.deliveryMethod === "pickup"
                ? `Pickup · ${university.shortName}`
                : "Shipping"}
            </dd>
          </div>
          {checkout.deliveryMethod === "shipping" ? (
            <div className="kv">
              <dt>Address</dt>
              <dd>{checkout.shippingAddress}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Payment slip</span>
        </div>
        <div className="slip-proof">
          {slipPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={slipPreviewUrl} alt="Payment slip you uploaded" />
          ) : null}
          <span className="upload-meta">
            <span className="upload-filename">
              {slipFile ? slipFile.name : "No slip attached"}
            </span>
            <span className="upload-sub">
              {slipFile ? formatBytes(slipFile.size) : "Go back to upload one"}
            </span>
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Total</span>
        </div>
        <dl className="panel-body">
          <div className="kv">
            <dt>Item subtotal</dt>
            <dd>{formatThb(totals.itemSubtotalThb)}</dd>
          </div>
          <div className="kv">
            <dt>Shipping</dt>
            <dd>{formatThb(totals.shippingFeeThb)}</dd>
          </div>
          <div className="kv">
            <dt>
              <strong>Amount paid</strong>
            </dt>
            <dd>
              <strong>{formatThb(totals.finalTotalThb)}</strong>
            </dd>
          </div>
        </dl>
      </div>

      <p className="review-note">
        Confirming places the order. Staff will verify your payment slip and
        contact you on the phone number above.
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
            Keep this page open — don&apos;t close or refresh.
          </p>
        </div>
      ) : null}

      <div className="action-bar">
        <div className="action-bar-inner">
          <dl className="action-bar-total">
            <dt>Total</dt>
            <dd>{formatThb(totals.finalTotalThb)}</dd>
          </dl>
          <div className="action-bar-row">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
            >
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={!slipFile || isSubmitting}
              aria-busy={isSubmitting}
              type="button"
              onClick={onConfirm}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {submitStage === "confirming" ? "Confirming" : "Sending"}
                </>
              ) : (
                "Place order"
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
        <h2 className="display-lg">Order placed</h2>
        <p className="lede">
          Save your order ID. You&apos;ll need it if you contact us about this
          order.
        </p>

        <div className="order-id" role="status">
          <span className="order-id-value">{order.orderId}</span>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={copyOrderId}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="done-next">
          <h3>What happens next</h3>
          <p>
            Staff verify your payment slip manually, then confirm your order by
            phone. {university?.brand} ·{" "}
            {order.checkout.deliveryMethod === "pickup"
              ? "University pickup"
              : "Shipping"}{" "}
            · Payment {order.paymentStatus}.
          </p>
        </div>

        <div className="done-panel">
          <OrderItemsPanel items={order.items} />

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Total</span>
            </div>
            <dl className="panel-body">
              <div className="kv">
                <dt>Item subtotal</dt>
                <dd>{formatThb(order.itemSubtotalThb)}</dd>
              </div>
              <div className="kv">
                <dt>Shipping</dt>
                <dd>{formatThb(order.shippingFeeThb)}</dd>
              </div>
              <div className="kv">
                <dt>
                  <strong>Paid</strong>
                </dt>
                <dd>
                  <strong>{formatThb(order.finalTotalThb)}</strong>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <Link
          className="btn btn-primary btn-block"
          href="/tracking"
          style={{ marginTop: "var(--s-4)" }}
        >
          Track this order
        </Link>

        <button
          className="btn btn-secondary btn-block"
          type="button"
          onClick={onReset}
          style={{ marginTop: "var(--s-3)" }}
        >
          Start another order
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
        <span className="panel-title">Items</span>
        <span className="panel-title">
          {items.reduce((count, item) => count + item.quantity, 0)} pcs
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
              {item.colorName} · {item.size} × {item.quantity}
              {item.sizeSurchargeThb > 0
                ? ` · incl. ${formatThb(item.sizeSurchargeThb)} size surcharge`
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
      <h3 className="summary-title">Order summary</h3>
      <dl>
        <div className="summary-row">
          <dt>Item subtotal</dt>
          <dd>{formatThb(totals.itemSubtotalThb)}</dd>
        </div>
        <div className="summary-row">
          <dt>Shipping</dt>
          <dd>{formatThb(totals.shippingFeeThb)}</dd>
        </div>
        <div className="summary-row is-total">
          <dt>Total</dt>
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
        aria-label="Decrease quantity"
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
        aria-label="Increase quantity"
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
        reject(new Error("Order response could not be read."));
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
  universityId: UniversityId | null
) {
  if (!universityId) {
    return nextStep === "select";
  }

  if (nextStep === "cart") {
    return true;
  }

  if (["checkout", "payment", "review"].includes(nextStep)) {
    return items.length > 0;
  }

  return true;
}

function createSubmissionKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
