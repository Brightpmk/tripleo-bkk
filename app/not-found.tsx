import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found — Tripleo.bkk"
};

/**
 * Shown for any unknown URL, including an unsupported shop slug such as
 * `/shop/hello`. Uses the same shell and state block as the rest of the
 * storefront so it never looks like a different site.
 */
export default function NotFound() {
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
        </div>
      </header>

      <div className="content-container">
        <section className="step-section">
          <div className="state">
            <span className="state-mark" aria-hidden="true">
              ◇
            </span>
            <h1>Page not found</h1>
            <p>
              This page does not exist. Pick your university to open its
              collection.
            </p>
            <Link className="btn btn-primary" href="/">
              Choose a university
            </Link>
          </div>
        </section>
      </div>

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
