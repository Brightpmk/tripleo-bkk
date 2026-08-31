"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { formatThb } from "@/lib/format";
import { formatBangkokDateTime } from "@/lib/orders-admin";
import {
  buildTrackingTimeline,
  MAX_TRACKING_NAME_LENGTH,
  MAX_TRACKING_PHONE_LENGTH,
  showsShippingDetails,
  trackingOrderLabels,
  trackingPaymentLabels,
  trackingPaymentNotes,
  type PublicTrackedOrder,
  type TrackingSearchMode,
  type TrackingSearchResult
} from "@/lib/tracking";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; orders: PublicTrackedOrder[] }
  | { kind: "error"; message: string };

export function TrackingView() {
  const [mode, setMode] = useState<TrackingSearchMode>("phone");
  const [value, setValue] = useState("");
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const isPhone = mode === "phone";

  function switchMode(next: TrackingSearchMode) {
    if (next === mode) {
      return;
    }

    setMode(next);
    setValue("");
    setState({ kind: "idle" });
    inputRef.current?.focus();
  }

  async function search() {
    if (!value.trim() || state.kind === "loading") {
      return;
    }

    setState({ kind: "loading" });

    try {
      const response = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, value })
      });
      const result = (await response.json()) as TrackingSearchResult;

      if (!result.ok) {
        setState({ kind: "error", message: result.message });
        return;
      }

      setState({ kind: "results", orders: result.orders });
    } catch {
      setState({
        kind: "error",
        message:
          "We couldn't check your order right now. Please try again shortly."
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-left">
          <Link className="wordmark" href="/">
            Tripleo.bkk
          </Link>
        </div>
        <Link className="cart-btn" href="/">
          Shop
        </Link>
      </header>

      <div className="content-container">
        <section className="step-section track-section">
          <div className="section-head">
            <div className="section-head-text">
              <p className="eyebrow">Order tracking</p>
              <h1 className="display-lg">Track your order</h1>
            </div>
          </div>

          <p className="lede track-lede">
            Enter the name or phone number you used at checkout. No account
            needed.
          </p>

          <form
            className="track-form"
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <div
              className="track-modes"
              role="radiogroup"
              aria-label="Search by"
            >
              <button
                type="button"
                role="radio"
                aria-checked={isPhone}
                className={`track-mode${isPhone ? " is-selected" : ""}`}
                onClick={() => switchMode("phone")}
              >
                Phone number
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!isPhone}
                className={`track-mode${!isPhone ? " is-selected" : ""}`}
                onClick={() => switchMode("name")}
              >
                Full name
              </button>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={inputId}>
                {isPhone ? "Phone number" : "Full name"}
              </label>
              <input
                id={inputId}
                ref={inputRef}
                className="field-input"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                type={isPhone ? "tel" : "text"}
                inputMode={isPhone ? "tel" : "text"}
                autoComplete={isPhone ? "tel" : "name"}
                enterKeyHint="search"
                maxLength={
                  isPhone ? MAX_TRACKING_PHONE_LENGTH : MAX_TRACKING_NAME_LENGTH
                }
                placeholder={isPhone ? "08X XXX XXXX" : "e.g. Nattapong S."}
                autoCapitalize={isPhone ? "none" : "words"}
              />
              <span className="field-hint">
                {isPhone
                  ? "Spaces and dashes are fine."
                  : "Use the same spelling as your order."}
              </span>
            </div>

            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={!value.trim() || state.kind === "loading"}
              aria-busy={state.kind === "loading"}
            >
              {state.kind === "loading" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Checking
                </>
              ) : (
                "Track order"
              )}
            </button>
          </form>

          <div aria-live="polite">
            {state.kind === "error" ? (
              <p className="form-alert track-alert" role="alert">
                {state.message}
              </p>
            ) : null}

            {state.kind === "results" && state.orders.length === 0 ? (
              <div className="state">
                <span className="state-mark" aria-hidden="true">
                  ?
                </span>
                <h3>No orders found</h3>
                <p>
                  We couldn&apos;t find an order matching that information.
                  Please check your details and try again.
                </p>
              </div>
            ) : null}

            {state.kind === "results" && state.orders.length > 0 ? (
              <>
                <p className="track-count">
                  {state.orders.length} order
                  {state.orders.length === 1 ? "" : "s"} found
                </p>
                <div className="track-list">
                  {state.orders.map((order) => (
                    <TrackedOrderCard key={order.orderId} order={order} />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="site-footer">
        <span className="site-footer-brand">Tripleo.bkk</span>
        <span className="site-footer-note">
          Premium university streetwear · Bangkok
        </span>
      </footer>
    </main>
  );
}

function TrackedOrderCard({ order }: { order: PublicTrackedOrder }) {
  const timeline = buildTrackingTimeline(order.orderStatus);
  const shipping = showsShippingDetails(order);

  return (
    <article className="track-card">
      <header className="track-card-head">
        <div className="track-card-id">
          <span className="track-card-order">{order.orderId}</span>
          <span className="track-card-date">
            {formatBangkokDateTime(order.placedAtIso)}
          </span>
        </div>
        <span className="track-card-uni">{order.universityBrand}</span>
      </header>

      <div className="track-status-row">
        <div className="track-status-block">
          <span className="track-status-label">Payment</span>
          <span className={`track-badge is-${paymentTone(order)}`}>
            {trackingPaymentLabels[order.paymentStatus]}
          </span>
          <span className="track-status-note">
            {trackingPaymentNotes[order.paymentStatus]}
          </span>
        </div>
        <div className="track-status-block">
          <span className="track-status-label">Order</span>
          <span className={`track-badge is-${orderTone(order)}`}>
            {trackingOrderLabels[order.orderStatus]}
          </span>
        </div>
      </div>

      {timeline.cancelled ? (
        <p className="track-cancelled">
          This order was cancelled. Please contact us if you think this is a
          mistake.
        </p>
      ) : (
        <ol className="track-timeline">
          {timeline.steps.map((step) => (
            <li
              key={step.stage}
              className={`track-step${step.complete ? " is-complete" : ""}${
                step.current ? " is-current" : ""
              }`}
              aria-current={step.current ? "step" : undefined}
            >
              <span className="track-step-dot" aria-hidden="true" />
              <span className="track-step-text">
                <span className="track-step-label">{step.label}</span>
                <span className="track-step-desc">{step.description}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="track-items">
        <span className="track-section-label">
          Items ({order.itemCount})
        </span>
        {order.items.length === 0 ? (
          <p className="track-empty-items">
            Item details aren&apos;t available for this order.
          </p>
        ) : (
          <ul className="track-item-list">
            {order.items.map((item, index) => (
              <li className="track-item" key={`${item.shirtColor}-${item.size}-${index}`}>
                <span className="track-item-name">{item.shirtColor || "—"}</span>
                <span className="track-item-meta">
                  Size {item.size || "—"} × {item.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="track-facts">
        <div className="track-fact">
          <span className="track-fact-label">Delivery</span>
          <span className="track-fact-value">
            {shipping ? "Shipping" : "Pickup"}
          </span>
        </div>
        <div className="track-fact">
          <span className="track-fact-label">Total</span>
          <span className="track-fact-value">{formatThb(order.totalThb)}</span>
        </div>
      </div>

      {shipping ? (
        <div className="track-shipping">
          <span className="track-section-label">Shipping</span>
          {order.trackingNumber ? (
            <>
              {order.shippingProvider ? (
                <div className="track-fact">
                  <span className="track-fact-label">Provider</span>
                  <span className="track-fact-value">
                    {order.shippingProvider}
                  </span>
                </div>
              ) : null}
              <div className="track-fact">
                <span className="track-fact-label">Tracking no.</span>
                <span className="track-fact-value track-tracking-number">
                  {order.trackingNumber}
                </span>
              </div>
            </>
          ) : (
            <p className="track-pending-note">
              Tracking number will appear once your order is shipped.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function paymentTone(order: PublicTrackedOrder) {
  switch (order.paymentStatus) {
    case "verified":
      return "ok";
    case "rejected":
      return "bad";
    case "review_required":
      return "info";
    default:
      return "warn";
  }
}

function orderTone(order: PublicTrackedOrder) {
  switch (order.orderStatus) {
    case "completed":
      return "ok";
    case "cancelled":
      return "bad";
    case "shipped":
    case "preparing":
      return "info";
    default:
      return "warn";
  }
}
