import { redirect } from "next/navigation";
import { hasValidAdminSession } from "@/lib/server/admin-auth";
import { AdminLoginForm } from "./AdminLoginForm";
import "../admin.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLoginPage() {
  if (await hasValidAdminSession()) {
    redirect("/admin");
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <div className="admin-brand-mark" aria-hidden="true">T</div>
        <p className="admin-eyebrow">Tripleo.bkk</p>
        <h1 id="admin-login-title">Staff sign in</h1>
        <p className="admin-login-copy">
          Enter the store password to manage the product catalog.
        </p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
