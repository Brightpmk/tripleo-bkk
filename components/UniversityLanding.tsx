"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCart } from "./CartProvider";
import { getCartTotalQuantity } from "@/lib/cart";
import {
  getShopPath,
  getShopPathForUniversityId,
  universities
} from "@/lib/catalog";

/**
 * The `/` landing page: pick a university, go to its real shop route.
 *
 * Selecting a university is a plain <Link> to `/shop/<routeSlug>`, so every
 * shop is bookmarkable, shareable, refreshable, and works with Back/Forward.
 * The cart itself lives in CartProvider, above the router, so nothing here
 * touches it.
 */
export function UniversityLanding() {
  const { items, universityId } = useCart();
  const cartCount = getCartTotalQuantity(items);
  const cartPath = universityId
    ? `${getShopPathForUniversityId(universityId)}?step=cart`
    : null;

  useLegacyShopHashRedirect();

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-left">
          <Link className="wordmark" href="/">
            Tripleo.bkk
          </Link>
        </div>

        <div className="header-right">
          <Link className="track-nav-btn" href="/tracking">
            Track order
          </Link>
          {cartPath ? (
            <Link
              className="cart-btn"
              href={cartPath}
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
            </Link>
          ) : (
            <button
              className="cart-btn"
              type="button"
              disabled
              aria-label="Cart, 0 items"
            >
              Cart
            </button>
          )}
        </div>
      </header>

      <section className="landing" id="universities">
        <div className="landing-inner">
          <div className="landing-head">
            <p className="eyebrow">Tripleo.bkk</p>
            <h1 className="display-xl">
              Select your
              <br />
              <span className="serif-accent">university</span>
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
              <Link
                className="uni-card"
                key={university.id}
                href={getShopPath(university)}
                aria-label={`${university.brand} — ${university.fullName} (${university.thaiName})`}
              >
                <span className="uni-card-text">
                  <span className="uni-card-brand">{university.brand}</span>
                  <span className="uni-card-uni">{university.shortName}</span>
                  <span className="uni-card-thai">{university.thaiName}</span>
                </span>
                <span className="uni-card-go" aria-hidden="true">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span className="site-footer-brand">Tripleo.bkk</span>
        <span className="site-footer-note">
          Premium university streetwear ·{" "}
          <span className="serif-italic">Bangkok</span>
        </span>
      </footer>
    </main>
  );
}

/**
 * Legacy compatibility only — safe to delete once old links have aged out.
 *
 * Shop selection used to live in client state behind a `#shop-<universityId>`
 * fragment, so links already shared in the wild (e.g. `/#shop-bangmod`) land
 * here. A fragment is never sent to the server, so this is the only place it
 * can be handled: forward it once to the real route, then drop it. Nothing in
 * the app writes a hash any more.
 */
function useLegacyShopHashRedirect() {
  const router = useRouter();

  useEffect(() => {
    const match = /^#shop-([a-z-]+)$/.exec(window.location.hash);

    if (!match) {
      return;
    }

    const university = universities.find((entry) => entry.id === match[1]);

    window.history.replaceState(null, "", window.location.pathname);

    if (university) {
      router.replace(getShopPath(university));
    }
  }, [router]);
}
