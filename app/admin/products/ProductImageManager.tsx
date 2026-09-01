"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptedProductImageTypes,
  formatBytes,
  MAX_PRODUCT_IMAGE_SOURCE_BYTES,
  optimizeProductImage
} from "@/lib/product-image-client";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-image-limits";

type ProductImage = {
  id: string;
  imageUrl: string;
  sortOrder: number;
};

type UploadOutcome =
  | { ok: true; fileName: string }
  | { ok: false; fileName: string; message: string };

/**
 * Multi-image management for one product.
 *
 * Uploads run one file at a time so a single bad file reports its own error
 * without taking the batch down, and the page never freezes: the rest of the
 * editor stays interactive while images upload.
 *
 * Reordering is Move up / Move down rather than drag-and-drop — reliable on
 * touch, keyboard accessible, and no dependency.
 */
export function ProductImageManager({ productId }: { productId: string }) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/admin/products/${encodeURIComponent(productId)}/images`
    );
    const result = (await response.json()) as {
      ok?: boolean;
      images?: ProductImage[];
      message?: string;
    };

    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Product images could not be loaded.");
    }

    return result.images ?? [];
  }, [productId]);

  // Fetch on mount. State is only touched after the await resolves, and the
  // ignore flag drops a response that arrives after a product switch.
  useEffect(() => {
    let ignore = false;

    load()
      .then((loaded) => {
        if (!ignore) {
          setImages(loaded);
        }
      })
      .catch(() => {
        if (!ignore) {
          setMessage("Product images could not be loaded.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [load]);

  /** Re-reads the gallery after a failed write, to resync the UI. */
  async function reload() {
    try {
      setImages(await load());
    } catch {
      setMessage("Product images could not be loaded.");
    }
  }

  async function upload(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setMessage("");
    setOutcomes([]);

    const results: UploadOutcome[] = [];

    // Sequential: each request stays well under the platform body limit,
    // and progress stays legible.
    for (const [index, file] of files.entries()) {
      setBusy(`Uploading ${index + 1} of ${files.length}…`);

      const optimized = await optimizeProductImage(file, MAX_PRODUCT_IMAGE_BYTES);

      if (!optimized.ok) {
        results.push({ ok: false, fileName: file.name, message: optimized.message });
        continue;
      }

      const body = new FormData();
      body.append("images", optimized.file, optimized.file.name);

      try {
        const response = await fetch(
          `/api/admin/products/${encodeURIComponent(productId)}/images`,
          { method: "POST", body }
        );
        const result = (await response.json()) as {
          ok?: boolean;
          images?: ProductImage[];
          uploaded?: UploadOutcome[];
          message?: string;
        };

        if (!response.ok || !result.ok) {
          results.push({
            ok: false,
            fileName: file.name,
            message: result.message || "Upload failed."
          });
          continue;
        }

        const failure = result.uploaded?.find((entry) => !entry.ok);

        results.push(
          failure && !failure.ok
            ? { ok: false, fileName: file.name, message: failure.message }
            : { ok: true, fileName: file.name }
        );

        if (result.images) {
          setImages(result.images);
        }
      } catch {
        results.push({
          ok: false,
          fileName: file.name,
          message: "Upload failed. Please try again."
        });
      }
    }

    setBusy("");
    setOutcomes(results);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function remove(imageUrl: string) {
    setBusy("Removing image…");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/images`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl })
        }
      );
      const result = (await response.json()) as {
        ok?: boolean;
        images?: ProductImage[];
        message?: string;
      };

      if (!response.ok || !result.ok) {
        setMessage(result.message || "The image could not be removed.");
        return;
      }

      setImages(result.images ?? []);
    } catch {
      setMessage("The image could not be removed.");
    } finally {
      setBusy("");
    }
  }

  async function move(index: number, delta: number) {
    const next = [...images];
    const target = index + delta;

    if (target < 0 || target >= next.length) {
      return;
    }

    [next[index], next[target]] = [next[target], next[index]];
    setImages(next);
    setBusy("Saving order…");
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(productId)}/images`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls: next.map((image) => image.imageUrl) })
        }
      );
      const result = (await response.json()) as {
        ok?: boolean;
        images?: ProductImage[];
        message?: string;
      };

      if (!response.ok || !result.ok) {
        setMessage(result.message || "Image order could not be saved.");
        await reload();
        return;
      }

      setImages(result.images ?? next);
    } catch {
      setMessage("Image order could not be saved.");
      await reload();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="admin-images" aria-labelledby="admin-images-title">
      <div className="admin-images-head">
        <h3 className="admin-panel-title" id="admin-images-title">
          Product images
        </h3>
        <span className="admin-images-count">
          {images.length} image{images.length === 1 ? "" : "s"}
        </span>
      </div>

      <label className="admin-images-upload">
        <span className="admin-button admin-button-secondary">
          {busy ? busy : "Upload images"}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedProductImageTypes.join(",")}
          disabled={Boolean(busy)}
          onChange={(event) => upload(Array.from(event.target.files ?? []))}
        />
        <small>
          PNG, JPEG, or WEBP. Up to {formatBytes(MAX_PRODUCT_IMAGE_SOURCE_BYTES)}{" "}
          each — resized and converted to WebP automatically.
        </small>
      </label>

      {busy ? (
        <p className="admin-images-busy" role="status">
          <span className="spinner" aria-hidden="true" /> {busy}
        </p>
      ) : null}

      {message ? (
        <p className="admin-page-error" role="alert">
          {message}
        </p>
      ) : null}

      {outcomes.length > 0 ? (
        <ul className="admin-upload-results">
          {outcomes.map((outcome) => (
            <li
              key={outcome.fileName}
              className={outcome.ok ? "is-ok" : "is-bad"}
            >
              {outcome.fileName}
              {outcome.ok ? " — uploaded" : ` — ${outcome.message}`}
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <p className="admin-images-empty">Loading images…</p>
      ) : images.length === 0 ? (
        <p className="admin-images-empty">
          No images yet. The storefront will show a placeholder until you add
          one.
        </p>
      ) : (
        <ol className="admin-image-list">
          {images.map((image, index) => (
            <li className="admin-image-row" key={image.id || image.imageUrl}>
              <span className="admin-image-index">{index + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="admin-image-thumb"
                src={image.imageUrl}
                alt={`Product image ${index + 1}`}
                loading="lazy"
              />
              <div className="admin-image-meta">
                {index === 0 ? (
                  <span className="admin-image-primary">Primary image</span>
                ) : (
                  <span className="admin-image-position">
                    Position {index + 1}
                  </span>
                )}
              </div>
              <div className="admin-image-actions">
                <button
                  type="button"
                  className="admin-image-btn"
                  disabled={index === 0 || Boolean(busy)}
                  onClick={() => move(index, -1)}
                  aria-label={`Move image ${index + 1} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="admin-image-btn"
                  disabled={index === images.length - 1 || Boolean(busy)}
                  onClick={() => move(index, 1)}
                  aria-label={`Move image ${index + 1} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="admin-image-btn is-danger"
                  disabled={Boolean(busy)}
                  onClick={() => remove(image.imageUrl)}
                  aria-label={`Delete image ${index + 1}`}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
