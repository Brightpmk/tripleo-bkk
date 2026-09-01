import type { Metadata } from "next";
import { TrackingView } from "./TrackingView";

export const metadata: Metadata = {
  title: "ติดตามคำสั่งซื้อ — Tripleo.bkk",
  description:
    "ตรวจสอบสถานะคำสั่งซื้อ Tripleo.bkk ของคุณ ด้วยชื่อ-นามสกุลหรือเบอร์โทรศัพท์ที่ใช้ตอนสั่งซื้อ",
  robots: { index: true, follow: true }
};

export const dynamic = "force-dynamic";

export default function TrackingPage() {
  return <TrackingView />;
}
