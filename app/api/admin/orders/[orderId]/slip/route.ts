import { hasValidAdminSession } from "@/lib/server/admin-auth";
import {
  getAdminOrderDetail,
  getAdminOrderSlipFileId
} from "@/lib/server/order-admin-service";
import { GoogleDriveSlipStorage } from "@/lib/server/payment-slip-storage";

export const runtime = "nodejs";

/**
 * Streams a payment slip to an authenticated admin.
 *
 * The Drive file stays private: it is fetched server-side with the store's
 * own OAuth credentials and proxied as bytes. No Drive URL, file ID, refresh
 * token, or client secret is ever handed to the browser, and the slip is
 * addressed by ORDER_ID so a caller cannot ask for an arbitrary Drive file.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  if (!(await hasValidAdminSession())) {
    return Response.json(
      { ok: false, message: "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const { orderId } = await context.params;
    const order = await getAdminOrderDetail(orderId);

    if (!order) {
      return Response.json(
        { ok: false, message: "Order was not found." },
        { status: 404 }
      );
    }

    const fileId = await getAdminOrderSlipFileId(orderId);

    if (!fileId) {
      return Response.json(
        { ok: false, message: "This order has no payment slip." },
        { status: 404 }
      );
    }

    const slip = await new GoogleDriveSlipStorage().read(fileId);

    return new Response(new Uint8Array(slip.buffer), {
      status: 200,
      headers: {
        "Content-Type": slip.mimeType,
        "Content-Length": String(slip.buffer.byteLength),
        // Never cached by a shared cache, never indexed.
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Disposition": `inline; filename="slip-${orderId}"`
      }
    });
  } catch (error) {
    console.error("Admin slip read failed", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });

    return Response.json(
      { ok: false, message: "Payment slip could not be loaded." },
      { status: 500 }
    );
  }
}
