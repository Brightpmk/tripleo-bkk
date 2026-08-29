"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
  availableSizes,
  getProductsForUniversity,
  getUniversityById,
  products,
  universities,
  type JerseySize,
  type Product,
  type UniversityId
} from "@/lib/catalog";
import {
  addCartItem,
  getCartItemSubtotal,
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
  type DeliveryMethod
} from "@/lib/pricing";
import { acceptedSlipMimeTypes, validateSlipFile } from "@/lib/slip";

type Step = "select" | "shop" | "cart" | "checkout" | "payment" | "review" | "success";

type ProductChoice = {
  size: JerseySize;
  quantity: number;
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
  checkout: "Checkout",
  payment: "Payment",
  review: "Review",
  success: "Success"
};

const checkoutSteps: Step[] = [
  "select",
  "shop",
  "cart",
  "checkout",
  "payment",
  "review"
];

export function StorefrontApp() {
  const [selectedUniversityId, setSelectedUniversityId] =
    useState<UniversityId | null>(null);
  const [step, setStep] = useState<Step>("select");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [choices, setChoices] = useState<Record<string, ProductChoice>>(() =>
    Object.fromEntries(
      products.map((product) => [
        product.id,
        {
          size: "M",
          quantity: 1
        }
      ])
    )
  );
  const [checkout, setCheckout] =
    useState<CheckoutDetails>(defaultCheckout);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipError, setSlipError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [submissionKey, setSubmissionKey] = useState(createSubmissionKey);
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedUniversity = selectedUniversityId
    ? getUniversityById(selectedUniversityId)
    : null;
  const availableProducts = selectedUniversityId
    ? getProductsForUniversity(selectedUniversityId)
    : [];
  const totals = useMemo(
    () => calculateOrderTotals(cartItems, checkout.deliveryMethod),
    [cartItems, checkout.deliveryMethod]
  );

  function selectUniversity(universityId: UniversityId) {
    if (selectedUniversityId && selectedUniversityId !== universityId) {
      setCartItems([]);
      setSlipFile(null);
      setOrder(null);
      setSubmissionError("");
      setSubmissionKey(createSubmissionKey());
    }

    setSelectedUniversityId(universityId);
    setStep("shop");
    window.history.replaceState(null, "", `#shop-${universityId}`);
    window.setTimeout(() => {
      document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
    }, 0);
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

    const choice = choices[product.id] ?? { size: "M", quantity: 1 };
    setCartItems((current) =>
      addCartItem(current, {
        product,
        universityId: selectedUniversityId,
        size: choice.size,
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
    }
  }

  function selectSlip(file: File | null) {
    setSlipError("");
    setSubmissionError("");
    setSlipFile(null);

    if (!file) {
      return;
    }

    const validation = validateSlipFile(file);

    if (!validation.ok) {
      setSlipError(validation.message);
      return;
    }

    setSlipFile(file);
  }

  async function confirmOrder() {
    if (!selectedUniversityId || !slipFile || cartItems.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
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
          quantity: item.quantity
        }))
      };
      const formData = new FormData();
      formData.append("order", JSON.stringify(orderPayload));
      formData.append("slip", slipFile, slipFile.name);
      const response = await fetch("/api/orders", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as OrderSubmissionResult;

      if (!result.ok) {
        setSubmissionError(result.message);
        setIsSubmitting(false);
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
    }
  }

  function resetOrder() {
    setCartItems([]);
    setCheckout(defaultCheckout);
    setSlipFile(null);
    setOrder(null);
    setFormErrors({});
    setSlipError("");
    setSubmissionError("");
    setSubmissionKey(createSubmissionKey());
    setStep(selectedUniversityId ? "shop" : "select");
  }

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <main className="app-shell">
      {/* ── Sticky Header ── */}
      <header className="site-header">
        <div className="site-header-inner">
          <button
            className="brand-wordmark"
            type="button"
            onClick={() => {
              setStep("select");
            }}
          >
            KingGallery.Studio
          </button>
          {selectedUniversity ? (
            <span className="university-badge">
              {selectedUniversity.name}
            </span>
          ) : null}
        </div>
        <button
          className="cart-button"
          type="button"
          onClick={() => setStep(cartItems.length > 0 ? "cart" : "shop")}
          disabled={!selectedUniversityId}
          aria-label={`Shopping cart with ${cartCount} items`}
        >
          Cart
          <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      {/* ── Landing: University Selection ── */}
      {step === "select" ? (
        <section className="landing" id="universities">
          <div className="landing-header">
            <p className="section-label">University Jersey Collection</p>
            <h1 className="display-xl">Choose Your Campus</h1>
            <p className="body-lg">
              Select your university to explore our exclusive jersey collection.
              Premium designs crafted for campus culture.
            </p>
          </div>

          <div className="university-selection" aria-label="Choose one university">
            {universities.map((university) => (
              <button
                className="uni-card"
                key={university.id}
                onClick={() => selectUniversity(university.id)}
                type="button"
                style={{ "--uni-accent": university.accent } as React.CSSProperties}
              >
                <div className="uni-card-content">
                  <div className="uni-card-icon">
                    {university.name.charAt(0)}
                  </div>
                  <div className="uni-card-name">{university.name}</div>
                  <div className="uni-card-sub">{university.displayName}</div>
                  <span className="uni-card-cta">Shop Collection</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Content Area ── */}
      {step !== "select" ? (
        <div className="content-container">
          {/* Step Navigation */}
          {selectedUniversity ? (
            <nav className="step-nav" aria-label="Checkout progress">
              {checkoutSteps.map((checkoutStep) => (
                <button
                  className={`step-btn ${step === checkoutStep ? "active" : ""}`}
                  disabled={!canOpenStep(checkoutStep, cartItems, selectedUniversityId)}
                  key={checkoutStep}
                  onClick={() => setStep(checkoutStep)}
                  type="button"
                >
                  {stepLabels[checkoutStep]}
                </button>
              ))}
            </nav>
          ) : null}

          {/* ── Shop ── */}
          {step === "shop" && selectedUniversity ? (
            <ShopSection
              products={availableProducts}
              selectedUniversityName={selectedUniversity.name}
              choices={choices}
              onChoiceChange={updateChoice}
              onAddProduct={addProduct}
            />
          ) : null}

          {/* ── Cart ── */}
          {step === "cart" && selectedUniversity ? (
            <CartSection
              items={cartItems}
              universityName={selectedUniversity.name}
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

          {/* ── Checkout ── */}
          {step === "checkout" && selectedUniversity ? (
            <CheckoutSection
              checkout={checkout}
              errors={formErrors}
              totals={totals}
              universityName={selectedUniversity.name}
              onChange={setCheckout}
              onContinue={continueToPayment}
            />
          ) : null}

          {/* ── Payment ── */}
          {step === "payment" && selectedUniversity ? (
            <PaymentSection
              finalTotalThb={totals.finalTotalThb}
              slipFile={slipFile}
              slipError={slipError}
              onSlipChange={selectSlip}
              onContinue={() => slipFile && setStep("review")}
            />
          ) : null}

          {/* ── Review ── */}
          {step === "review" && selectedUniversity ? (
            <ReviewSection
              checkout={checkout}
              isSubmitting={isSubmitting}
              items={cartItems}
              submissionError={submissionError}
              slipFile={slipFile}
              totals={totals}
              universityName={selectedUniversity.name}
              onBack={() => setStep("payment")}
              onConfirm={confirmOrder}
            />
          ) : null}

          {/* ── Success ── */}
          {step === "success" && order ? (
            <SuccessSection order={order} onReset={resetOrder} />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

/* ════════════════════════════════════════════════════════════════
   Shop Section
   ════════════════════════════════════════════════════════════════ */
function ShopSection({
  products,
  selectedUniversityName,
  choices,
  onChoiceChange,
  onAddProduct
}: {
  products: Product[];
  selectedUniversityName: string;
  choices: Record<string, ProductChoice>;
  onChoiceChange: (productId: string, choice: Partial<ProductChoice>) => void;
  onAddProduct: (product: Product) => void;
}) {
  return (
    <section id="shop">
      <div className="section-header">
        <div className="section-header-text">
          <p className="section-label">{selectedUniversityName}</p>
          <h2 className="display-lg">Jersey Collection</h2>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏷️</div>
          <h3>No jerseys available</h3>
          <p>Check back soon for new releases.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map((product) => {
            const choice = choices[product.id] ?? { size: "M", quantity: 1 };

            return (
              <article className="product-card" key={product.id}>
                <div className="product-card-image">
                  <Image
                    src={product.image}
                    alt={`${product.name} product image`}
                    width={560}
                    height={420}
                  />
                  {product.availability ? (
                    <span className="product-badge">{product.availability}</span>
                  ) : null}
                </div>

                <div className="product-card-body">
                  <div className="product-card-meta">
                    <h3 className="product-card-name">{product.name}</h3>
                    <p className="product-card-color">{product.colorName}</p>
                  </div>

                  <div className="product-card-price">{formatThb(product.priceThb)}</div>

                  {/* Size selection as pills */}
                  <div className="size-selector">
                    <span className="size-selector-label">Size</span>
                    <div className="size-pills">
                      {availableSizes.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`size-pill ${choice.size === size ? "selected" : ""}`}
                          onClick={() =>
                            onChoiceChange(product.id, { size })
                          }
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quantity stepper */}
                  <div className="qty-row">
                    <span className="qty-label">Quantity</span>
                    <div className="qty-stepper">
                      <button
                        className="qty-stepper-btn"
                        type="button"
                        onClick={() =>
                          onChoiceChange(product.id, {
                            quantity: Math.max(1, choice.quantity - 1)
                          })
                        }
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <input
                        className="qty-stepper-value"
                        type="number"
                        min="1"
                        max="20"
                        value={choice.quantity}
                        onChange={(event) =>
                          onChoiceChange(product.id, {
                            quantity: Number(event.target.value)
                          })
                        }
                        aria-label="Quantity"
                      />
                      <button
                        className="qty-stepper-btn"
                        type="button"
                        onClick={() =>
                          onChoiceChange(product.id, {
                            quantity: Math.min(20, choice.quantity + 1)
                          })
                        }
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <button
                    className="btn btn-add-cart"
                    type="button"
                    onClick={() => onAddProduct(product)}
                  >
                    Add to Cart
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
   Cart Section
   ════════════════════════════════════════════════════════════════ */
function CartSection({
  items,
  universityName,
  onQuantityChange,
  onRemove,
  onContinue,
  onShop
}: {
  items: CartItem[];
  universityName: string;
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
    <section className="cart-section">
      <div className="section-header">
        <div className="section-header-text">
          <p className="section-label">{universityName}</p>
          <h2 className="display-lg">Your Cart</h2>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onShop}>
          Continue Shopping
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🛒</div>
          <h3>Your cart is empty</h3>
          <p>Browse our collection and find your perfect jersey.</p>
          <button className="btn btn-primary" type="button" onClick={onShop}>
            Browse Jerseys
          </button>
        </div>
      ) : (
        <>
          <div className="cart-items">
            {items.map((item) => (
              <article className="cart-item" key={item.lineId}>
                <div className="cart-item-image">
                  <Image
                    src={item.image}
                    alt={`${item.productName} product image`}
                    width={120}
                    height={120}
                  />
                </div>

                <div className="cart-item-details">
                  <div className="cart-item-name">{item.productName}</div>
                  <div className="cart-item-meta">
                    {universityName} · {item.colorName} · Size {item.size}
                  </div>
                  <div className="cart-item-unit-price">
                    {formatThb(item.unitPriceThb)} each
                  </div>
                </div>

                <div className="cart-item-actions">
                  <div className="cart-item-total">
                    {formatThb(getCartItemSubtotal(item))}
                  </div>
                  <div className="qty-stepper">
                    <button
                      className="qty-stepper-btn"
                      type="button"
                      onClick={() =>
                        onQuantityChange(item.lineId, Math.max(0, item.quantity - 1))
                      }
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <input
                      className="qty-stepper-value"
                      type="number"
                      min="0"
                      max="20"
                      value={item.quantity}
                      onChange={(event) =>
                        onQuantityChange(item.lineId, Number(event.target.value))
                      }
                      aria-label="Quantity"
                    />
                    <button
                      className="qty-stepper-btn"
                      type="button"
                      onClick={() =>
                        onQuantityChange(item.lineId, Math.min(20, item.quantity + 1))
                      }
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => onRemove(item.lineId)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="cart-summary">
            <span className="cart-summary-label">Item Subtotal</span>
            <span className="cart-summary-value">{formatThb(subtotal)}</span>
          </div>

          <button
            className="btn btn-primary btn-wide"
            type="button"
            onClick={onContinue}
          >
            Continue to Checkout
          </button>
        </>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Checkout Section
   ════════════════════════════════════════════════════════════════ */
function CheckoutSection({
  checkout,
  errors,
  totals,
  universityName,
  onChange,
  onContinue
}: {
  checkout: CheckoutDetails;
  errors: Record<string, string>;
  totals: ReturnType<typeof calculateOrderTotals>;
  universityName: string;
  onChange: (checkout: CheckoutDetails) => void;
  onContinue: () => void;
}) {
  return (
    <section className="checkout-layout">
      <div className="checkout-main">
        {/* Customer Information */}
        <div className="form-section">
          <div className="section-header-text">
            <p className="section-label">{universityName}</p>
            <h2 className="display-lg">Checkout</h2>
          </div>

          <h3 className="form-section-title">Customer Information</h3>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label" htmlFor="checkout-name">
                Full Name
              </label>
              <input
                id="checkout-name"
                className="form-input"
                value={checkout.fullName}
                onChange={(event) =>
                  onChange({ ...checkout, fullName: event.target.value })
                }
                aria-invalid={Boolean(errors.fullName)}
              />
              {errors.fullName ? (
                <span className="form-error">{errors.fullName}</span>
              ) : null}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="checkout-phone">
                Phone Number
              </label>
              <input
                id="checkout-phone"
                className="form-input"
                inputMode="tel"
                value={checkout.phone}
                onChange={(event) =>
                  onChange({ ...checkout, phone: event.target.value })
                }
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone ? (
                <span className="form-error">{errors.phone}</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Delivery Method */}
        <div className="form-section">
          <h3 className="form-section-title">Delivery Method</h3>

          <fieldset>
            <legend className="form-label">Choose how you&apos;d like to receive your order</legend>
            <div className="delivery-options">
              {(["pickup", "shipping"] as DeliveryMethod[]).map((method) => (
                <label
                  className={`delivery-card ${checkout.deliveryMethod === method ? "selected" : ""}`}
                  key={method}
                >
                  <input
                    checked={checkout.deliveryMethod === method}
                    name="deliveryMethod"
                    type="radio"
                    onChange={() =>
                      onChange({ ...checkout, deliveryMethod: method })
                    }
                  />
                  <div className="delivery-card-check" aria-hidden="true" />
                  <div className="delivery-card-header">
                    <span className="delivery-card-title">
                      {method === "pickup" ? "Pickup" : "Shipping"}
                    </span>
                    <span className="delivery-card-price">
                      {method === "pickup" ? "Free" : "+50 THB"}
                    </span>
                  </div>
                  <p className="delivery-card-desc">
                    {method === "pickup"
                      ? `Collect at ${universityName} campus`
                      : "Delivered to your address — flat rate per order"}
                  </p>
                </label>
              ))}
            </div>
          </fieldset>

          {checkout.deliveryMethod === "shipping" ? (
            <div className="form-field">
              <label className="form-label" htmlFor="checkout-address">
                Shipping Address
              </label>
              <textarea
                id="checkout-address"
                className="form-textarea"
                rows={4}
                value={checkout.shippingAddress}
                onChange={(event) =>
                  onChange({ ...checkout, shippingAddress: event.target.value })
                }
                aria-invalid={Boolean(errors.shippingAddress)}
                placeholder="Enter your full shipping address"
              />
              {errors.shippingAddress ? (
                <span className="form-error">{errors.shippingAddress}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          className="btn btn-primary btn-wide"
          type="button"
          onClick={onContinue}
        >
          Continue to Payment
        </button>
      </div>

      <TotalsPanel totals={totals} />
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Payment Section
   ════════════════════════════════════════════════════════════════ */
function PaymentSection({
  finalTotalThb,
  slipFile,
  slipError,
  onSlipChange,
  onContinue
}: {
  finalTotalThb: number;
  slipFile: File | null;
  slipError: string;
  onSlipChange: (file: File | null) => void;
  onContinue: () => void;
}) {
  return (
    <section className="payment-section">
      <div className="section-header">
        <div className="section-header-text">
          <p className="section-label">Payment</p>
          <h2 className="display-lg">Complete Your Payment</h2>
        </div>
      </div>

      {/* Amount display */}
      <div className="payment-amount">
        <div className="payment-amount-label">Amount Due</div>
        <div className="payment-amount-value">{formatThb(finalTotalThb)}</div>
      </div>

      {/* QR + Instructions */}
      <div className="payment-qr-area">
        <div className="qr-wrapper">
          <Image
            src="/payment/qr-placeholder.svg"
            alt="KingGallery.Studio payment QR placeholder"
            width={420}
            height={420}
          />
        </div>

        <div className="payment-instructions">
          <h3>How to Pay</h3>
          <ol className="payment-steps">
            <li>Scan the QR code to transfer the exact amount shown above</li>
            <li>Take a screenshot of your transfer confirmation</li>
            <li>Upload the payment slip below</li>
            <li>Review and confirm your order</li>
          </ol>
          <p>
            Staff will verify your payment manually before processing your order.
          </p>
        </div>
      </div>

      {/* Slip upload */}
      <label
        className={`file-upload-area ${slipFile ? "has-file" : ""}`}
      >
        {slipFile ? (
          <>
            <span className="file-upload-icon">✓</span>
            <span className="file-upload-filename">{slipFile.name}</span>
            <span className="file-upload-change">Click to change file</span>
          </>
        ) : (
          <>
            <span className="file-upload-icon">📎</span>
            <span className="file-upload-text">Upload Payment Slip</span>
            <span className="file-upload-hint">
              JPG, PNG, or WEBP — max 5 MB
            </span>
          </>
        )}
        <input
          accept={acceptedSlipMimeTypes.join(",")}
          type="file"
          onChange={(event) =>
            onSlipChange(event.target.files?.item(0) ?? null)
          }
        />
      </label>
      {slipError ? (
        <p className="form-error" style={{ marginTop: "8px" }}>
          {slipError}
        </p>
      ) : null}

      <button
        className="btn btn-primary btn-wide"
        disabled={!slipFile}
        type="button"
        onClick={onContinue}
        style={{ marginTop: "24px" }}
      >
        Review Order
      </button>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Review Section
   ════════════════════════════════════════════════════════════════ */
function ReviewSection({
  checkout,
  isSubmitting,
  items,
  submissionError,
  slipFile,
  totals,
  universityName,
  onBack,
  onConfirm
}: {
  checkout: CheckoutDetails;
  isSubmitting: boolean;
  items: CartItem[];
  submissionError: string;
  slipFile: File | null;
  totals: ReturnType<typeof calculateOrderTotals>;
  universityName: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="review-section">
      <div className="section-header">
        <div className="section-header-text">
          <p className="section-label">{universityName}</p>
          <h2 className="display-lg">Review Your Order</h2>
        </div>
      </div>

      {/* Order items */}
      <div className="review-block">
        <div className="review-block-title">Order Items</div>
        {items.map((item) => (
          <div className="review-item" key={item.lineId}>
            <div className="review-item-image">
              <Image
                src={item.image}
                alt={`${item.productName}`}
                width={60}
                height={60}
              />
            </div>
            <div>
              <div className="review-item-name">{item.productName}</div>
              <div className="review-item-details">
                {item.colorName} · Size {item.size} × {item.quantity}
              </div>
            </div>
            <div className="review-item-total">
              {formatThb(getCartItemSubtotal(item))}
            </div>
          </div>
        ))}
      </div>

      {/* Customer details */}
      <div className="review-block">
        <div className="review-block-title">Customer Details</div>
        <div className="review-details">
          <div className="review-detail-row">
            <span className="review-detail-label">Customer</span>
            <span className="review-detail-value">{checkout.fullName}</span>
          </div>
          <div className="review-detail-row">
            <span className="review-detail-label">Phone</span>
            <span className="review-detail-value">{checkout.phone}</span>
          </div>
          <div className="review-detail-row">
            <span className="review-detail-label">Delivery</span>
            <span className="review-detail-value">
              {checkout.deliveryMethod === "pickup" ? "Pickup" : "Shipping"}
            </span>
          </div>
          {checkout.deliveryMethod === "shipping" ? (
            <div className="review-detail-row">
              <span className="review-detail-label">Address</span>
              <span className="review-detail-value">
                {checkout.shippingAddress}
              </span>
            </div>
          ) : null}
          <div className="review-detail-row">
            <span className="review-detail-label">Payment slip</span>
            <span className="review-detail-value">
              {slipFile ? "✓ Uploaded" : "Missing"}
            </span>
          </div>
        </div>
      </div>

      {/* Order totals */}
      <div className="review-block">
        <div className="review-block-title">Order Total</div>
        <div className="review-totals">
          <div className="review-total-row">
            <span>Item subtotal</span>
            <span>{formatThb(totals.itemSubtotalThb)}</span>
          </div>
          <div className="review-total-row">
            <span>Shipping fee</span>
            <span>{formatThb(totals.shippingFeeThb)}</span>
          </div>
          <div className="review-total-row review-total-final">
            <span>Total</span>
            <span>{formatThb(totals.finalTotalThb)}</span>
          </div>
        </div>
      </div>

      <p className="review-confirm-note">
        This is the final step. By confirming, your order will be placed and staff will review your payment slip.
      </p>
      {submissionError ? (
        <p className="form-error" role="alert">
          {submissionError}
        </p>
      ) : null}

      <div className="review-actions">
        <button className="btn btn-secondary" type="button" onClick={onBack}>
          Back to Payment
        </button>
        <button
          className="btn btn-primary"
          disabled={!slipFile || isSubmitting}
          type="button"
          onClick={onConfirm}
        >
          {isSubmitting ? "Placing Order…" : "Confirm & Place Order"}
        </button>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Success Section
   ════════════════════════════════════════════════════════════════ */
function SuccessSection({
  order,
  onReset
}: {
  order: ConfirmedOrder;
  onReset: () => void;
}) {
  const university = getUniversityById(order.universityId);

  return (
    <section className="success-section">
      <div className="success-icon" aria-hidden="true">✓</div>
      <h2 className="display-lg">Order Placed Successfully</h2>
      <p className="body-lg">
        Thank you for your order. Please save your Order ID below.
      </p>

      <div className="order-id-display" role="status">
        {order.orderId}
      </div>

      <div className="success-summary">
        <div className="review-block">
          <div className="review-block-title">Order Summary</div>
          {order.items.map((item) => (
            <div className="review-item" key={item.lineId}>
              <div className="review-item-image">
                <Image
                  src={item.image}
                  alt={item.productName}
                  width={60}
                  height={60}
                />
              </div>
              <div>
                <div className="review-item-name">{item.productName}</div>
                <div className="review-item-details">
                  Size {item.size} × {item.quantity}
                </div>
              </div>
              <div className="review-item-total">
                {formatThb(getCartItemSubtotal(item))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="success-info">
        {university?.name} · {formatThb(order.finalTotalThb)} · Payment{" "}
        {order.paymentStatus}
      </p>

      <button className="btn btn-primary" type="button" onClick={onReset}>
        Start Another Order
      </button>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════
   Totals Panel (sidebar)
   ════════════════════════════════════════════════════════════════ */
function TotalsPanel({
  totals
}: {
  totals: ReturnType<typeof calculateOrderTotals>;
}) {
  return (
    <aside className="totals-sidebar" aria-label="Order totals">
      <h3 className="totals-sidebar-title">Order Summary</h3>
      <div className="totals-row">
        <span className="totals-row-label">Item subtotal</span>
        <span className="totals-row-value">{formatThb(totals.itemSubtotalThb)}</span>
      </div>
      <div className="totals-row">
        <span className="totals-row-label">Shipping fee</span>
        <span className="totals-row-value">{formatThb(totals.shippingFeeThb)}</span>
      </div>
      <div className="totals-row totals-row-final">
        <span className="totals-row-label">Total</span>
        <span className="totals-row-value">{formatThb(totals.finalTotalThb)}</span>
      </div>
    </aside>
  );
}

/* ════════════════════════════════════════════════════════════════
   Step navigation guard (unchanged business logic)
   ════════════════════════════════════════════════════════════════ */
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
