"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatThb } from "@/lib/format";
import type { PaymentStatus } from "@/lib/orders";
import {
  formatBangkokDateTime,
  MAX_SHIPPING_PROVIDER_LENGTH,
  MAX_TRACKING_NUMBER_LENGTH,
  orderStatuses,
  orderStatusLabels,
  paymentStatuses,
  paymentStatusLabels,
  type AdminOrderDetail,
  type AdminOrderPatch,
  type AdminOrderStatus
} from "@/lib/orders-admin";
import { OrderStatusBadge, PaymentBadge } from "../AdminOrderPresenters";

type SaveState = "idle" | "saving" | "saved" | "error";

export function AdminOrderDetailView({ order }: { order: AdminOrderDetail }) {
  const [current, setCurrent] = useState(order);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    order.paymentStatus
  );
  const [orderStatus, setOrderStatus] = useState<AdminOrderStatus>(
    order.orderStatus
  );
  const [shippingProvider, setShippingProvider] = useState(
    order.shippingProvider
  );
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [slipOpen, setSlipOpen] = useState(false);

  const dirty =
    paymentStatus !== current.paymentStatus ||
    orderStatus !== current.orderStatus ||
    shippingProvider !== current.shippingProvider ||
    trackingNumber !== current.trackingNumber;

  useEffect(() => {
    if (saveState !== "saved") {
      return;
    }

    const timer = window.setTimeout(() => setSaveState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  async function save() {
    if (!dirty || saveState === "saving") {
      return;
    }

    setSaveState("saving");
    setMessage("");

    // Only changed fields are sent; the server allowlists them again.
    const patch: AdminOrderPatch = {};
    if (paymentStatus !== current.paymentStatus) patch.paymentStatus = paymentStatus;
    if (orderStatus !== current.orderStatus) patch.orderStatus = orderStatus;
    if (shippingProvider !== current.shippingProvider) {
      patch.shippingProvider = shippingProvider;
    }
    if (trackingNumber !== current.trackingNumber) {
      patch.trackingNumber = trackingNumber;
    }

    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(current.orderId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        }
      );
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        order?: AdminOrderDetail;
      };

      if (!response.ok || !result.ok || !result.order) {
        setSaveState("error");
        setMessage(result.message || "Order could not be updated.");
        return;
      }

      setCurrent(result.order);
      setPaymentStatus(result.order.paymentStatus);
      setOrderStatus(result.order.orderStatus);
      setShippingProvider(result.order.shippingProvider);
      setTrackingNumber(result.order.trackingNumber);
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setMessage("Order could not be updated. Please try again.");
    }
  }

  const isShipping = current.deliveryMethod === "shipping";

  return (
    <section className="admin-content">
      <div className="admin-section-head">
        <div>
          <p className="admin-eyebrow">{current.universityLabel}</p>
          <h2 className="order-detail-id">{current.orderId}</h2>
          <p>Placed {formatBangkokDateTime(current.createdAtIso)} (Bangkok)</p>
        </div>
        <div className="admin-detail-actions">
          <CopyButton label="Copy order ID" value={current.orderId} />
          <Link className="admin-button admin-button-secondary" href="/admin/orders">
            Back
          </Link>
        </div>
      </div>

      {current.dataIssues.length > 0 ? (
        <p className="admin-warning" role="status">
          Data check: {current.dataIssues.join(" · ")}
        </p>
      ) : null}

      <div className="order-detail-grid">
        <div className="order-detail-main">
          <Panel title="Customer">
            <Row label="Name" value={current.customerName || "—"} />
            <Row
              label="Phone"
              value={current.phone || "—"}
              action={
                current.phone ? (
                  <CopyButton label="Copy" value={current.phone} subtle />
                ) : null
              }
            />
          </Panel>

          <Panel title={`Items (${current.itemCount})`}>
            {current.items.length === 0 ? (
              <p className="order-detail-empty">
                No order items found for this order ID.
              </p>
            ) : (
              <div className="order-items">
                {current.items.map((item, index) => (
                  <div className="order-item" key={item.itemId || index}>
                    <div className="order-item-main">
                      <span className="order-item-name">
                        {item.shirtColor || item.productId || "—"}
                      </span>
                      <span className="order-item-meta">
                        Size {item.size || "—"} · {formatThb(item.unitPriceThb)} ×{" "}
                        {item.quantity}
                      </span>
                    </div>
                    <span className="order-item-total">
                      {formatThb(item.lineTotalThb)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Payment">
            <Row label="Subtotal" value={formatThb(current.subtotalThb)} />
            <Row label="Shipping fee" value={formatThb(current.shippingFeeThb)} />
            <Row
              label="Order total"
              value={<strong>{formatThb(current.totalThb)}</strong>}
            />
            <Row
              label="Status"
              value={<PaymentBadge order={current} />}
            />
            <Row
              label="Slip"
              value={current.hasSlip ? "Attached" : "Not attached"}
              action={
                current.hasSlip ? (
                  <button
                    className="admin-button admin-button-secondary admin-button-sm"
                    type="button"
                    onClick={() => setSlipOpen((open) => !open)}
                  >
                    {slipOpen ? "Hide slip" : "View slip"}
                  </button>
                ) : null
              }
            />
            {slipOpen && current.hasSlip ? (
              <div className="slip-viewer">
                {/* Proxied through the authenticated admin API — the Drive
                    file itself is never made public. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/admin/orders/${encodeURIComponent(current.orderId)}/slip`}
                  alt={`Payment slip for order ${current.orderId}`}
                />
                <p className="order-detail-note">
                  A slip on file is not proof of payment. Verify the transfer,
                  then set the payment status.
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Delivery">
            <Row
              label="Method"
              value={isShipping ? "Shipping" : "Pickup"}
            />
            {isShipping ? (
              <Row
                label="Address"
                value={current.shippingAddress || "—"}
              />
            ) : null}
          </Panel>
        </div>

        <aside className="order-detail-side">
          <div className="admin-panel order-actions">
            <h3 className="admin-panel-title">Update order</h3>

            <label className="admin-field">
              <span>Payment status</span>
              <select
                value={paymentStatus}
                onChange={(event) =>
                  setPaymentStatus(event.target.value as PaymentStatus)
                }
                disabled={saveState === "saving"}
              >
                {paymentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>Order status</span>
              <select
                value={orderStatus}
                onChange={(event) =>
                  setOrderStatus(event.target.value as AdminOrderStatus)
                }
                disabled={saveState === "saving"}
              >
                {orderStatuses.map((status) => (
                  <option key={status} value={status}>
                    {orderStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              <span>Shipping provider</span>
              <input
                value={shippingProvider}
                maxLength={MAX_SHIPPING_PROVIDER_LENGTH}
                placeholder={isShipping ? "e.g. Kerry, Flash" : "Pickup order"}
                onChange={(event) => setShippingProvider(event.target.value)}
                disabled={!isShipping || saveState === "saving"}
              />
            </label>

            <label className="admin-field">
              <span>Tracking number</span>
              <input
                value={trackingNumber}
                maxLength={MAX_TRACKING_NUMBER_LENGTH}
                placeholder={isShipping ? "Optional" : "Pickup order"}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => setTrackingNumber(event.target.value)}
                disabled={!isShipping || saveState === "saving"}
              />
            </label>

            {trackingNumber && isShipping ? (
              <CopyButton label="Copy tracking number" value={trackingNumber} subtle />
            ) : null}

            {message ? (
              <p className="admin-page-error" role="alert">
                {message}
              </p>
            ) : null}

            {saveState === "saved" ? (
              <p className="admin-notice" role="status">
                Order updated.
              </p>
            ) : null}

            <button
              className="admin-button admin-button-primary"
              type="button"
              onClick={save}
              disabled={!dirty || saveState === "saving"}
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>

          <div className="admin-panel">
            <h3 className="admin-panel-title">Current</h3>
            <Row label="Payment" value={<PaymentBadge order={current} />} />
            <Row label="Order" value={<OrderStatusBadge order={current} />} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Panel({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-panel">
      <h3 className="admin-panel-title">{title}</h3>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  action
}: {
  label: string;
  value: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{value}</span>
      {action ? <span className="detail-row-action">{action}</span> : null}
    </div>
  );
}

function CopyButton({
  label,
  value,
  subtle = false
}: {
  label: string;
  value: string;
  subtle?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className={`admin-button admin-button-secondary admin-button-sm${
        subtle ? " admin-button-quiet" : ""
      }`}
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard can be blocked; the value stays visible on screen.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
