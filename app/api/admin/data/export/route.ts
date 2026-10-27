import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { getAdminDataSnapshot } from "@/lib/server/admin-data";
import { createAdminDataWorkbook } from "@/lib/server/admin-data-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET() {
  if (!(await hasValidAdminSession())) {
    return Response.json({ message: "Authentication required." }, { status: 401, headers });
  }
  try {
    const snapshot = await getAdminDataSnapshot();
    const buffer = await createAdminDataWorkbook(snapshot);
    const date = snapshot.loadedAt.slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      headers: {
        ...headers,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tripleo-data-${date}.xlsx"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return Response.json({ message: "Export could not be completed. Please try again." }, { status: 500, headers });
  }
}
