import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StorefrontApp } from "@/components/StorefrontApp";
import { getUniversityByRouteSlug, type Product } from "@/lib/catalog";
import {
  getCachedProductCatalog,
  ProductCatalogError
} from "@/lib/server/product-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ShopRouteParams = { university: string };

/**
 * Real, shareable shop routes: `/shop/bm`, `/shop/msu`, … The slug is
 * validated against the centralized university configuration in
 * lib/catalog.ts, so anything else (e.g. `/shop/hello`) 404s.
 */
export default async function ShopPage(props: {
  params: Promise<ShopRouteParams>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const university = await resolveUniversity(props.params);

  if (!university) {
    notFound();
  }

  const searchParams = props.searchParams ? await props.searchParams : {};
  const initialStep = searchParams.step === "cart" ? "cart" : undefined;

  let products: Product[] = [];
  let catalogError = "";

  try {
    products = await getCachedProductCatalog();
  } catch (error) {
    console.error("Product catalog load failed", getCatalogErrorDiagnostics(error));
    catalogError =
      "Product catalog is unavailable right now. Please try again in a moment.";
  }

  return (
    <Suspense fallback={null}>
      <StorefrontApp
        initialProducts={products}
        university={university}
        catalogError={catalogError}
        initialStep={initialStep}
      />
    </Suspense>
  );
}

export async function generateMetadata({
  params
}: {
  params: Promise<ShopRouteParams>;
}): Promise<Metadata> {
  const university = await resolveUniversity(params);

  if (!university) {
    return { title: "Shop not found — Tripleo.bkk" };
  }

  const title = `${university.brand} — ${university.shortName} · Tripleo.bkk`;

  return {
    title,
    description: `Shop the Tripleo.bkk ${university.brand} collection for ${university.fullName} (${university.thaiName}). Premium university streetwear.`,
    alternates: { canonical: `/shop/${university.routeSlug}` },
    openGraph: { title, type: "website" }
  };
}

async function resolveUniversity(params: Promise<ShopRouteParams>) {
  const { university } = await params;
  return getUniversityByRouteSlug(university);
}

function getCatalogErrorDiagnostics(error: unknown) {
  const errorName = error instanceof Error ? error.name : "UnknownError";

  if (error instanceof ProductCatalogError) {
    return { errorName, message: error.message };
  }

  if (
    error instanceof Error &&
    error.message.startsWith("Missing required server environment variables:")
  ) {
    return { errorName, message: error.message };
  }

  return { errorName };
}
