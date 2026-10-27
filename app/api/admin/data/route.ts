import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getAdminDataSnapshot } from "@/lib/server/admin-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET() {
  if (!(await hasValidAdminSession())) {
    return Response.json({ message: "Authentication required." }, { status: 401, headers });
  }
  try {
    return Response.json(await getAdminDataSnapshot(), { headers });
  } catch {
    return Response.json({ message: "Data could not be loaded. Please try again." }, { status: 500, headers });
  }
}
