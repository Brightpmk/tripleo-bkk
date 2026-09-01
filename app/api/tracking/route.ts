import { getLoginSource } from "@/lib/server/admin-request-security";
import { isTrackingLookupAllowed } from "@/lib/server/tracking-rate-limit";
import {
  searchTrackedOrders,
  TrackingUnavailableError
} from "@/lib/server/tracking-service";
import type { TrackingSearchResult } from "@/lib/tracking";

export const runtime = "nodejs";
/** A lookup is personal to the caller — never cache or prerender it. */
export const dynamic = "force-dynamic";

const GENERIC_ERROR: TrackingSearchResult = {
  ok: false,
  message: "ไม่สามารถตรวจสอบคำสั่งซื้อได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
};

/**
 * Public order lookup. POST rather than GET so the customer's name or phone
 * never lands in a URL, browser history, or an access log.
 */
export async function POST(request: Request) {
  if (!isTrackingLookupAllowed(getLoginSource(request))) {
    return json(
      {
        ok: false,
        message: "ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
      },
      429
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json(
      { ok: false, message: "กรุณากรอกชื่อ-นามสกุลหรือเบอร์โทรศัพท์" },
      400
    );
  }

  const input = (payload ?? {}) as { mode?: unknown; value?: unknown };

  try {
    const result = await searchTrackedOrders({
      mode: input.mode,
      value: input.value
    });

    if (!result.ok) {
      return json({ ok: false, message: result.message }, result.status);
    }

    return json({ ok: true, orders: result.orders }, 200);
  } catch (error) {
    if (!(error instanceof TrackingUnavailableError)) {
      // The service logs its own detail; this only catches the unexpected.
      console.error("Tracking request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
    }

    return json(GENERIC_ERROR, 503);
  }
}

function json(body: TrackingSearchResult, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}
