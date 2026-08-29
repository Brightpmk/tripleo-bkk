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
  type ConfirmedOrder,
  submitMockOrder
} from "@/lib/orders";
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
    if (!selectedUniversityId || !slipFile || cartItems.length === 0) {
      return;
    }

    setIsSubmitting(true);
    const submittedOrder = await submitMockOrder({
      universityId: selectedUniversityId,
      items: cartItems,
      checkout,
      itemSubtotalThb: totals.itemSubtotalThb,
      shippingFeeThb: totals.shippingFeeThb,
      finalTotalThb: totals.finalTotalThb,
      slipSelected: true
    });
    setOrder(submittedOrder);
    setStep("success");
    setIsSubmitting(false);
  }

  function resetOrder() {
    setCartItems([]);
    setCheckout(defaultCheckout);
    setSlipFile(null);
    setOrder(null);
    setFormErrors({});
    setSlipError("");
    setStep(selectedUniversityId ? "shop" : "select");
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <nav className="topbar" aria-label="Store">
          <a href="#universities" className="brand">
            KingGallery.Studio
          </a>
          <button
            className="cart-pill"
            type="button"
            onClick={() => setStep(cartItems.length > 0 ? "cart" : "shop")}
            disabled={!selectedUniversityId}
          >
            Cart <span>{cartItems.reduce((count, item) => count + item.quantity, 0)}</span>
          </button>
        </nav>

        <section className="hero-grid" id="universities">
          <div className="hero-copy">
            <p className="eyebrow">University Jersey Orders</p>
            <h1>Pick your campus. Build your cart. Pay by QR.</h1>
            <p>
              A shopping-style order flow for KingGallery.Studio jerseys, built
              for quick mobile checkout without customer accounts.
            </p>
          </div>

          <div className="university-grid" aria-label="Choose one university">
            {universities.map((university) => (
              <button
                className="university-card"
                key={university.id}
                onClick={() => selectUniversity(university.id)}
                style={{ "--accent": university.accent } as React.CSSProperties}
                type="button"
              >
                <span>{university.name}</span>
                <small>{university.displayName}</small>
              </button>
            ))}
          </div>
        </section>
      </header>

      <div className="content-shell">
        {selectedUniversity ? (
          <div className="progress" aria-label="Checkout progress">
            {checkoutSteps.map((checkoutStep) => (
              <button
                className={step === checkoutStep ? "active" : ""}
                disabled={!canOpenStep(checkoutStep, cartItems, selectedUniversityId)}
                key={checkoutStep}
                onClick={() => setStep(checkoutStep)}
                type="button"
              >
                {stepLabels[checkoutStep]}
              </button>
            ))}
          </div>
        ) : null}

        {step === "shop" && selectedUniversity ? (
          <ShopSection
            products={availableProducts}
            selectedUniversityName={selectedUniversity.name}
            choices={choices}
            onChoiceChange={updateChoice}
            onAddProduct={addProduct}
          />
        ) : null}

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

        {step === "payment" && selectedUniversity ? (
          <PaymentSection
            finalTotalThb={totals.finalTotalThb}
            slipFile={slipFile}
            slipError={slipError}
            onSlipChange={selectSlip}
            onContinue={() => slipFile && setStep("review")}
          />
        ) : null}

        {step === "review" && selectedUniversity ? (
          <ReviewSection
            checkout={checkout}
            isSubmitting={isSubmitting}
            items={cartItems}
            slipFile={slipFile}
            totals={totals}
            universityName={selectedUniversity.name}
            onBack={() => setStep("payment")}
            onConfirm={confirmOrder}
          />
        ) : null}

        {step === "success" && order ? (
          <SuccessSection order={order} onReset={resetOrder} />
        ) : null}
      </div>
    </main>
  );
}

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
    <section className="shop-section" id="shop">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{selectedUniversityName}</p>
          <h2>Jerseys available for this university</h2>
        </div>
      </div>

      <div className="product-grid">
        {products.map((product) => {
          const choice = choices[product.id] ?? { size: "M", quantity: 1 };

          return (
            <article className="product-card" key={product.id}>
              <Image
                src={product.image}
                alt={`${product.name} product image`}
                width={560}
                height={420}
              />
              <div className="product-body">
                <div>
                  <p className="availability">{product.availability}</p>
                  <h3>{product.name}</h3>
                  <p>{product.colorName}</p>
                </div>
                <strong>{formatThb(product.priceThb)}</strong>
                <div className="selection-row">
                  <label>
                    Size
                    <select
                      value={choice.size}
                      onChange={(event) =>
                        onChoiceChange(product.id, {
                          size: event.target.value as JerseySize
                        })
                      }
                    >
                      {availableSizes.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Qty
                    <input
                      min="1"
                      max="20"
                      type="number"
                      value={choice.quantity}
                      onChange={(event) =>
                        onChoiceChange(product.id, {
                          quantity: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="primary-button"
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
    </section>
  );
}

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
    <section className="panel-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{universityName}</p>
          <h2>Your cart</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onShop}>
          Continue shopping
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <h3>Your cart is empty</h3>
          <button className="primary-button" type="button" onClick={onShop}>
            Browse jerseys
          </button>
        </div>
      ) : (
        <>
          <div className="cart-list">
            {items.map((item) => (
              <article className="cart-line" key={item.lineId}>
                <Image
                  src={item.image}
                  alt={`${item.productName} product image`}
                  width={120}
                  height={90}
                />
                <div className="cart-line-main">
                  <h3>{item.productName}</h3>
                  <p>
                    {universityName} · {item.colorName} · Size {item.size}
                  </p>
                  <p>{formatThb(item.unitPriceThb)} each</p>
                </div>
                <label className="quantity-control">
                  Qty
                  <input
                    min="0"
                    max="20"
                    type="number"
                    value={item.quantity}
                    onChange={(event) =>
                      onQuantityChange(item.lineId, Number(event.target.value))
                    }
                  />
                </label>
                <strong>{formatThb(getCartItemSubtotal(item))}</strong>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => onRemove(item.lineId)}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
          <div className="cart-footer">
            <span>Item subtotal</span>
            <strong>{formatThb(subtotal)}</strong>
          </div>
          <button className="primary-button wide" type="button" onClick={onContinue}>
            Continue to checkout
          </button>
        </>
      )}
    </section>
  );
}

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
    <section className="checkout-grid">
      <div className="panel-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{universityName}</p>
            <h2>Checkout details</h2>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Full name
            <input
              value={checkout.fullName}
              onChange={(event) =>
                onChange({ ...checkout, fullName: event.target.value })
              }
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName ? <small>{errors.fullName}</small> : null}
          </label>

          <label>
            Phone number
            <input
              inputMode="tel"
              value={checkout.phone}
              onChange={(event) =>
                onChange({ ...checkout, phone: event.target.value })
              }
              aria-invalid={Boolean(errors.phone)}
            />
            {errors.phone ? <small>{errors.phone}</small> : null}
          </label>
        </div>

        <fieldset>
          <legend>Delivery method</legend>
          <div className="method-grid">
            {(["pickup", "shipping"] as DeliveryMethod[]).map((method) => (
              <label className="method-option" key={method}>
                <input
                  checked={checkout.deliveryMethod === method}
                  name="deliveryMethod"
                  type="radio"
                  onChange={() => onChange({ ...checkout, deliveryMethod: method })}
                />
                <span>{method === "pickup" ? "Pickup" : "Shipping"}</span>
                <small>
                  {method === "pickup"
                    ? `${universityName} pickup`
                    : "Flat 50 THB per order"}
                </small>
              </label>
            ))}
          </div>
        </fieldset>

        {checkout.deliveryMethod === "shipping" ? (
          <label>
            Shipping address
            <textarea
              rows={4}
              value={checkout.shippingAddress}
              onChange={(event) =>
                onChange({ ...checkout, shippingAddress: event.target.value })
              }
              aria-invalid={Boolean(errors.shippingAddress)}
            />
            {errors.shippingAddress ? (
              <small>{errors.shippingAddress}</small>
            ) : null}
          </label>
        ) : null}

        <button className="primary-button wide" type="button" onClick={onContinue}>
          Continue to payment
        </button>
      </div>

      <TotalsPanel totals={totals} />
    </section>
  );
}

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
    <section className="checkout-grid">
      <div className="panel-section payment-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Payment pending</p>
            <h2>{formatThb(finalTotalThb)}</h2>
          </div>
        </div>

        <div className="payment-layout">
          <Image
            className="qr-image"
            src="/payment/qr-placeholder.svg"
            alt="KingGallery.Studio payment QR placeholder"
            width={420}
            height={420}
          />
          <div className="payment-copy">
            <h3>Scan to transfer</h3>
            <p>
              Upload a transfer slip after payment. Staff will verify payment
              manually before fulfillment.
            </p>
            <label className="file-drop">
              <span>{slipFile ? slipFile.name : "Select payment slip"}</span>
              <input
                accept={acceptedSlipMimeTypes.join(",")}
                type="file"
                onChange={(event) =>
                  onSlipChange(event.target.files?.item(0) ?? null)
                }
              />
            </label>
            {slipError ? <small className="error-text">{slipError}</small> : null}
            <button
              className="primary-button wide"
              disabled={!slipFile}
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

function ReviewSection({
  checkout,
  isSubmitting,
  items,
  slipFile,
  totals,
  universityName,
  onBack,
  onConfirm
}: {
  checkout: CheckoutDetails;
  isSubmitting: boolean;
  items: CartItem[];
  slipFile: File | null;
  totals: ReturnType<typeof calculateOrderTotals>;
  universityName: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="checkout-grid">
      <div className="panel-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{universityName}</p>
            <h2>Final review</h2>
          </div>
        </div>

        <div className="review-list">
          {items.map((item) => (
            <div className="review-line" key={item.lineId}>
              <span>
                {item.productName} · {item.colorName} · Size {item.size} ×{" "}
                {item.quantity}
              </span>
              <strong>{formatThb(getCartItemSubtotal(item))}</strong>
            </div>
          ))}
        </div>

        <dl className="detail-list">
          <div>
            <dt>Customer</dt>
            <dd>{checkout.fullName}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{checkout.phone}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{checkout.deliveryMethod === "pickup" ? "Pickup" : "Shipping"}</dd>
          </div>
          {checkout.deliveryMethod === "shipping" ? (
            <div>
              <dt>Address</dt>
              <dd>{checkout.shippingAddress}</dd>
            </div>
          ) : null}
          <div>
            <dt>Payment slip</dt>
            <dd>{slipFile ? "Selected" : "Missing"}</dd>
          </div>
        </dl>

        <div className="action-row">
          <button className="secondary-button" type="button" onClick={onBack}>
            Back to payment
          </button>
          <button
            className="primary-button"
            disabled={!slipFile || isSubmitting}
            type="button"
            onClick={onConfirm}
          >
            {isSubmitting ? "Creating order..." : "Confirm order"}
          </button>
        </div>
      </div>

      <TotalsPanel totals={totals} />
    </section>
  );
}

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
      <div className="success-card">
        <p className="eyebrow">Order created</p>
        <h2>Thank you. Save your Order ID.</h2>
        <div className="order-id">{order.orderId}</div>
        <p>
          {university?.name} · {formatThb(order.finalTotalThb)} · Payment{" "}
          {order.paymentStatus}
        </p>
        <div className="review-list">
          {order.items.map((item) => (
            <div className="review-line" key={item.lineId}>
              <span>
                {item.productName} · Size {item.size} × {item.quantity}
              </span>
              <strong>{formatThb(getCartItemSubtotal(item))}</strong>
            </div>
          ))}
        </div>
        <button className="primary-button" type="button" onClick={onReset}>
          Start another order
        </button>
      </div>
    </section>
  );
}

function TotalsPanel({
  totals
}: {
  totals: ReturnType<typeof calculateOrderTotals>;
}) {
  return (
    <aside className="totals-panel" aria-label="Order totals">
      <h3>Order totals</h3>
      <div>
        <span>Item subtotal</span>
        <strong>{formatThb(totals.itemSubtotalThb)}</strong>
      </div>
      <div>
        <span>Shipping fee</span>
        <strong>{formatThb(totals.shippingFeeThb)}</strong>
      </div>
      <div className="final-total">
        <span>Final total</span>
        <strong>{formatThb(totals.finalTotalThb)}</strong>
      </div>
    </aside>
  );
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
