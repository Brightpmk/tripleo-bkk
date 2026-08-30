import {
  establishAdminSession,
  getAdminSession,
  verifyAdminPassword
} from "@/lib/server/admin-auth";
import {
  clearLoginFailures,
  getLoginSource,
  isLoginAllowed,
  isSameOriginRequest,
  recordLoginFailure
} from "@/lib/server/admin-request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { ok: false, message: "Unable to sign in." },
      { status: 403 }
    );
  }

  const source = getLoginSource(request);

  if (!isLoginAllowed(source)) {
    return Response.json(
      { ok: false, message: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  let password = "";

  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    // Use the same response as an incorrect password.
  }

  if (!(await verifyAdminPassword(password))) {
    recordLoginFailure(source);
    return Response.json(
      { ok: false, message: "Invalid password." },
      { status: 401 }
    );
  }

  try {
    await establishAdminSession(await getAdminSession());
    clearLoginFailures(source);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { ok: false, message: "Unable to sign in." },
      { status: 500 }
    );
  }
}
