import type { Metadata } from "next";
import { TrackingView } from "./TrackingView";

export const metadata: Metadata = {
  title: "Track your order — Tripleo.bkk",
  description:
    "Check the status of your Tripleo.bkk order using the name or phone number you ordered with.",
  robots: { index: true, follow: true }
};

export const dynamic = "force-dynamic";

export default function TrackingPage() {
  return <TrackingView />;
}
