import type { Metadata } from "next";
import { UniversityLanding } from "@/components/UniversityLanding";

export const metadata: Metadata = {
  title: "Tripleo.bkk — Select your university",
  description:
    "Premium streetwear shirts for eight Thai universities. Choose your university to open its Tripleo.bkk collection.",
  alternates: { canonical: "/" }
};

/**
 * `/` is now the university selection landing page only. Each card links to
 * a real `/shop/<slug>` route — no catalog data is needed here, so the page
 * stays static and instant.
 */
export default function Home() {
  return <UniversityLanding />;
}
