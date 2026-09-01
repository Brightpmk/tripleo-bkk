import { Suspense } from "react";
import { StorefrontApp } from "@/components/StorefrontApp";
import type { Product } from "@/lib/catalog";
import {
  getCachedProductCatalog,
  ProductCatalogError
} from "@/lib/server/product-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = props.searchParams ? await props.searchParams : {};
  const initialStep =
    searchParams.step === "cart"
      ? "cart"
      : searchParams.step === "shop"
      ? "shop"
      : undefined;

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
        catalogError={catalogError}
        initialStep={initialStep}
      />
    </Suspense>
  );
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
