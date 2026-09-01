import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Product } from "@/lib/catalog";
import { getSupabaseProductDetail } from "@/lib/server/supabase/product-repository";
import { ProductDetailView } from "./ProductDetailView";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadProduct(productId: string): Promise<Product | null> {
  try {
    return await getSupabaseProductDetail(productId);
  } catch (error) {
    console.error("Product detail load failed", {
      productId,
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    return null;
  }
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  const product = await loadProduct(productId);

  if (!product) {
    return { title: "Product — Tripleo.bkk" };
  }

  return {
    title: `${product.colorName} — Tripleo.bkk`,
    description: `${product.name} from Tripleo.bkk. Premium university streetwear.`,
    openGraph: { images: product.image ? [product.image] : [] }
  };
}

export default async function ProductDetailPage({
  params
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await loadProduct(productId);

  if (!product) {
    notFound();
  }

  return <ProductDetailView product={product} />;
}
