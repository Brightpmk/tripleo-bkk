"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCart } from "@/components/CartProvider";
import { ProductGallery } from "@/components/ProductGallery";
import { addCartItem, getCartTotalQuantity } from "@/lib/cart";
import { getShopPath, getUniversityById, type Product } from "@/lib/catalog";
import { formatThb } from "@/lib/format";
import {
  getSizeSurchargeThb,
  getUnitPriceThbForSize,
  hasSizeSurcharge,
  SIZE_SURCHARGE_THB
} from "@/lib/size-pricing";

const MAX_LINE_QUANTITY = 20;

/**
 * Product detail.
 *
 * Every price shown here comes from lib/size-pricing.ts and every cart write
 * goes through lib/cart.ts — the same functions the storefront uses, so there
 * is no second pricing implementation to drift.
 */
export function ProductDetailView({ product }: { product: Product }) {
  const { items, setItems, universityId, setUniversityId } = useCart();
  const [size, setSize] = useState(product.availableSizes[0] ?? "M");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const university = getUniversityById(
    universityId && product.sellableUniversityIds.includes(universityId)
      ? universityId
      : product.primaryUniversityId
  );

  const surcharge = getSizeSurchargeThb(size);
  const unitPrice = getUnitPriceThbForSize(product.priceThb, size);
  const hasSurchargedSize = product.availableSizes.some(hasSizeSurcharge);
  const cartCount = useMemo(() => getCartTotalQuantity(items), [items]);
  const gallery = product.images?.length ? product.images : [product.image];
  // Real shop route for this campus, so Back and Cart both land on a URL the
  // shopper could bookmark or share.
  const shopPath = university ? getShopPath(university) : "/";

  function addToCart() {
    if (!university) {
      return;
    }

    // Keep the storefront on the same campus the shopper just bought from.
    setUniversityId(university.id);
    setItems((current) =>
      addCartItem(current, {
        product,
        universityId: university.id,
        size,
        quantity
      })
    );
    setAdded(true);
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-left">
          <Link className="wordmark" href="/">
            Tripleo.bkk
          </Link>
          {university ? (
            <span className="uni-tag" title={university.fullName}>
              <span className="uni-dot" aria-hidden="true" />
              {university.brand}
            </span>
          ) : null}
        </div>
        <div className="header-right">
          <Link className="track-nav-btn is-thai" href="/tracking">
            ติดตามคำสั่งซื้อ
          </Link>
          <Link className="cart-btn" href={`${shopPath}?step=cart`}>
            Cart
            {cartCount > 0 ? (
              <span className="cart-btn-count" aria-hidden="true">
                {cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <div className="content-container">
        <section className="step-section detail-section">
          <Link className="detail-back" href={shopPath}>
            ← Back to shop
          </Link>

          <ProductGallery
            images={gallery}
            alt={`${product.name} — ${product.colorName}`}
          />

          <div className="detail-body">
            <p className="eyebrow">{university?.brand ?? ""}</p>
            <h1 className="display-lg detail-title">{product.colorName}</h1>
            <p className="detail-name">{product.name}</p>

            <p className="detail-price">{formatThb(unitPrice)}</p>
            {surcharge > 0 ? (
              <p className="price-note">
                {formatThb(product.priceThb)} + {formatThb(surcharge)} for {size}
              </p>
            ) : null}

            <div className="size-field detail-field">
              <div className="size-field-head">
                <span className="size-field-label" id="detail-size-label">
                  Size
                </span>
                <span className="size-field-value">{size}</span>
              </div>
              <div
                className="size-list"
                role="group"
                aria-labelledby="detail-size-label"
              >
                {product.availableSizes.map((option) => {
                  const optionSurcharge = getSizeSurchargeThb(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      className={`size-opt${size === option ? " is-selected" : ""}`}
                      aria-pressed={size === option}
                      aria-label={
                        optionSurcharge > 0
                          ? `Size ${option}, plus ${optionSurcharge} THB`
                          : `Size ${option}`
                      }
                      onClick={() => {
                        setSize(option);
                        setAdded(false);
                      }}
                    >
                      <span aria-hidden="true">{option}</span>
                      {optionSurcharge > 0 ? (
                        <span className="size-opt-fee" aria-hidden="true">
                          +{optionSurcharge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {hasSurchargedSize ? (
                <p className="size-note">
                  Size 3XL ขึ้นไปเพิ่มราคา {formatThb(SIZE_SURCHARGE_THB)}.
                </p>
              ) : null}
            </div>

            <div className="detail-field detail-qty-row">
              <span className="qty-label">Quantity</span>
              <div className="qty">
                <button
                  className="qty-btn"
                  type="button"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  className="qty-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_LINE_QUANTITY}
                  value={quantity}
                  aria-label={`Quantity of ${product.name}`}
                  onChange={(event) => {
                    if (event.target.value === "") {
                      return;
                    }

                    const next = Number(event.target.value);
                    setQuantity(
                      Number.isFinite(next)
                        ? Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(next)))
                        : 1
                    );
                  }}
                />
                <button
                  className="qty-btn"
                  type="button"
                  disabled={quantity >= MAX_LINE_QUANTITY}
                  onClick={() =>
                    setQuantity((value) => Math.min(MAX_LINE_QUANTITY, value + 1))
                  }
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="action-bar">
            <div className="action-bar-inner">
              <dl className="action-bar-total">
                <dt>{quantity > 1 ? `${quantity} × ${size}` : size}</dt>
                <dd>{formatThb(unitPrice * quantity)}</dd>
              </dl>
              <div className="action-bar-row">
                {added ? (
                  <Link className="btn btn-primary" href={`${shopPath}?step=cart`}>
                    View cart
                  </Link>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={addToCart}
                  >
                    Add to cart
                  </button>
                )}
              </div>
            </div>
            {added ? (
              <p className="detail-added" role="status">
                Added to your cart.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <span className="site-footer-brand">Tripleo.bkk</span>
        <span className="site-footer-note">
          Premium university streetwear · Bangkok
        </span>
        <Link className="site-footer-link is-thai" href="/tracking">
          ติดตามคำสั่งซื้อ
        </Link>
      </footer>
    </main>
  );
}
