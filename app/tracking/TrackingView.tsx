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
        message: "ไม่สามารถตรวจสอบคำสั่งซื้อได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
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
          หน้าร้าน
        </Link>
      </header>

      <div className="content-container">
        <section className="step-section track-section">
          <div className="section-head">
            <div className="section-head-text">
              <p className="eyebrow">Tripleo.bkk</p>
              <h1 className="display-lg">ติดตามคำสั่งซื้อ</h1>
            </div>
          </div>

          <p className="lede track-lede">
            กรอกชื่อ-นามสกุลหรือเบอร์โทรศัพท์ที่คุณใช้ตอนสั่งซื้อ
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
              aria-label="ค้นหาด้วย"
            >
              <button
                type="button"
                role="radio"
                aria-checked={isPhone}
                className={`track-mode${isPhone ? " is-selected" : ""}`}
                onClick={() => switchMode("phone")}
              >
                เบอร์โทรศัพท์
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!isPhone}
                className={`track-mode${!isPhone ? " is-selected" : ""}`}
                onClick={() => switchMode("name")}
              >
                ชื่อ-นามสกุล
              </button>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={inputId}>
                {isPhone ? "ค้นหาด้วยเบอร์โทรศัพท์" : "ค้นหาด้วยชื่อ-นามสกุล"}
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
                placeholder={
                  isPhone ? "08xxxxxxxx" : "กรอกชื่อและนามสกุล"
                }
                autoCapitalize={isPhone ? "none" : "words"}
              />
              <span className="field-hint">
                {isPhone
                  ? "ใส่เว้นวรรคหรือขีดกลางได้"
                  : "กรุณาสะกดให้ตรงกับตอนที่สั่งซื้อ"}
              </span>
            </div>

            <button
              className="btn btn-primary btn-block is-thai"
              type="submit"
              disabled={!value.trim() || state.kind === "loading"}
              aria-busy={state.kind === "loading"}
            >
              {state.kind === "loading" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  กำลังค้นหา
                </>
              ) : (
                "ค้นหา"
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
              <div className="state is-thai">
                <span className="state-mark" aria-hidden="true">
                  ?
                </span>
                <h3>ไม่พบคำสั่งซื้อ</h3>
                <p>
                  ไม่พบคำสั่งซื้อที่ตรงกับข้อมูลนี้
                  กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง
                </p>
              </div>
            ) : null}

            {state.kind === "results" && state.orders.length > 0 ? (
              <>
                <p className="track-count">
                  พบ {state.orders.length} คำสั่งซื้อ
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
          เสื้อยืดสตรีทแวร์มหาวิทยาลัย · Bangkok
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
          <span className="track-status-label">สถานะการชำระเงิน</span>
          <span className={`track-badge is-${paymentTone(order)}`}>
            {trackingPaymentLabels[order.paymentStatus]}
          </span>
          <span className="track-status-note">
            {trackingPaymentNotes[order.paymentStatus]}
          </span>
        </div>
        <div className="track-status-block">
          <span className="track-status-label">สถานะคำสั่งซื้อ</span>
          <span className={`track-badge is-${orderTone(order)}`}>
            {trackingOrderLabels[order.orderStatus]}
          </span>
        </div>
      </div>

      {timeline.cancelled ? (
        <p className="track-cancelled">
          คำสั่งซื้อนี้ถูกยกเลิกแล้ว หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อเรา
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
          รายการสินค้า ({order.itemCount} ชิ้น)
        </span>
        {order.items.length === 0 ? (
          <p className="track-empty-items">
            ไม่มีรายละเอียดสินค้าสำหรับคำสั่งซื้อนี้
          </p>
        ) : (
          <ul className="track-item-list">
            {order.items.map((item, index) => (
              <li className="track-item" key={`${item.shirtColor}-${item.size}-${index}`}>
                <span className="track-item-name">{item.shirtColor || "—"}</span>
                <span className="track-item-meta">
                  ไซส์ {item.size || "—"} · จำนวน {item.quantity} ชิ้น
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="track-facts">
        <div className="track-fact">
          <span className="track-fact-label">วิธีรับสินค้า</span>
          <span className="track-fact-value">
            {shipping ? "จัดส่งพัสดุ" : "รับสินค้าด้วยตนเอง"}
          </span>
        </div>
        <div className="track-fact">
          <span className="track-fact-label">ยอดรวมทั้งหมด</span>
          <span className="track-fact-value">{formatThb(order.totalThb)}</span>
        </div>
      </div>

      {shipping ? (
        <div className="track-shipping">
          <span className="track-section-label">ข้อมูลการจัดส่ง</span>
          {order.trackingNumber ? (
            <>
              {order.shippingProvider ? (
                <div className="track-fact">
                  <span className="track-fact-label">บริษัทขนส่ง</span>
                  <span className="track-fact-value">
                    {order.shippingProvider}
                  </span>
                </div>
              ) : null}
              <div className="track-fact">
                <span className="track-fact-label">หมายเลขติดตามพัสดุ</span>
                <span className="track-fact-value track-tracking-number">
                  {order.trackingNumber}
                </span>
              </div>
            </>
          ) : (
            <p className="track-pending-note">
              ยังไม่มีหมายเลขติดตามพัสดุ
              จะแสดงเมื่อคำสั่งซื้อถูกจัดส่งแล้ว
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
