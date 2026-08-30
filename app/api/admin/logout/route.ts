import { destroyAdminSession } from "@/lib/server/admin-auth";
import { isSameOriginRequest } from "@/lib/server/admin-request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false }, { status: 403 });
  }

  try {
    await destroyAdminSession();
  } catch {
    // A missing or invalid session is already logged out.
  }

  return Response.json({ ok: true });
}
