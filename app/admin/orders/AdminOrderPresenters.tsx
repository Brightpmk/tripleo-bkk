import Link from "next/link";
import { formatThb } from "@/lib/format";
import {
  formatBangkokDateTime,
  orderStatusLabels,
  orderStatusTones,
  paymentStatusLabels,
  paymentStatusTones,
  type AdminOrderSummary,
  type StatusTone
} from "@/lib/orders-admin";

/**
 * Shared between the dashboard (server component) and the orders list
 * (client component). No directive of its own, so it adopts whichever
 * environment imports it.
 */

/** Colour is never the only signal — every badge carries its own text. */
export function StatusBadge({
  label,
  tone
}: {
  label: string;
  tone: StatusTone;
}) {
  return <span className={`status-badge is-${tone}`}>{label}</span>;
}

export function PaymentBadge({ order }: { order: AdminOrderSummary }) {
  return (
    <StatusBadge
      label={paymentStatusLabels[order.paymentStatus]}
      tone={paymentStatusTones[order.paymentStatus]}
    />
  );
}

export function OrderStatusBadge({ order }: { order: AdminOrderSummary }) {
  return (
    <StatusBadge
      label={orderStatusLabels[order.orderStatus]}
      tone={orderStatusTones[order.orderStatus]}
    />
  );
}

export function AdminOrderRow({
  order,
  compact = false
}: {
  order: AdminOrderSummary;
  compact?: boolean;
}) {
  return (
    <tr role="row">
      <td className="admin-cell-order" role="cell">
        <Link className="order-link" href={`/admin/orders/${order.orderId}`}>
          <span className="order-link-id">{order.orderId}</span>
          <span className="order-link-uni">{order.universityLabel}</span>
        </Link>
      </td>
      <td data-label="Placed" role="cell">
        {formatBangkokDateTime(order.createdAtIso)}
      </td>
      <td data-label="Customer" role="cell">
        <span className="order-customer">
          <span>{order.customerName || "—"}</span>
          {!compact ? (
            <span className="order-phone">{order.phone || "—"}</span>
          ) : null}
        </span>
      </td>
      {!compact ? (
        <td data-label="Items" role="cell">
          {order.itemCount}
        </td>
      ) : null}
      <td data-label="Total" role="cell">
        <strong>{formatThb(order.totalThb)}</strong>
      </td>
      <td data-label="Payment" role="cell">
        <PaymentBadge order={order} />
      </td>
      <td data-label="Delivery" role="cell">
        {order.deliveryMethod === "pickup" ? "Pickup" : "Shipping"}
        {!compact && order.trackingNumber ? (
          <span className="order-tracking">{order.trackingNumber}</span>
        ) : null}
      </td>
      <td data-label="Status" role="cell">
        <OrderStatusBadge order={order} />
      </td>
    </tr>
  );
}
