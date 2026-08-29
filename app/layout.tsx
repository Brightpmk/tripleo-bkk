import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KingGallery.Studio",
  description: "University jersey ordering for KingGallery.Studio"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
