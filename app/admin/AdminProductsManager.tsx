"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  adminProductSizes,
  adminUniversities,
  type AdminProduct,
  type AdminUniversity
} from "@/lib/admin-products";

type FilterUniversity = AdminUniversity | "ALL";
type FilterStatus = "ALL" | "ACTIVE" | "INACTIVE";

const emptyProduct: AdminProduct = {
  productId: "",
  university: "BANGMOD",
  jerseyColor: "",
  priceThb: 390,
  imageUrl: "",
  availableSizes: ["M", "L", "XL"],
  active: true,
  sortOrder: 0
};

export function AdminProductsManager({
  initialProducts,
  loadError
}: {
  initialProducts: AdminProduct[];
  loadError: string;
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [universityFilter, setUniversityFilter] =
    useState<FilterUniversity>("ALL");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (universityFilter === "ALL" || product.university === universityFilter) &&
          (statusFilter === "ALL" ||
            (statusFilter === "ACTIVE" ? product.active : !product.active))
      ),
    [products, statusFilter, universityFilter]
  );

  function closeEditor() {
    setEditing(null);
    setIsCreating(false);
  }

  function handleSaved(product: AdminProduct, created: boolean) {
    setProducts((current) => {
      const next = created
        ? [...current, product]
        : current.map((item) =>
            item.productId === product.productId ? product : item
          );
      return next.sort((a, b) => a.sortOrder - b.sortOrder);
    });
    setNotice(created ? "Product created." : "Product updated.");
    closeEditor();
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">KingGallery Studio</p>
          <h1>Products</h1>
        </div>
        <button
          className="admin-button admin-button-secondary"
          type="button"
          onClick={logout}
          disabled={loggingOut}
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </header>

      <section className="admin-content">
        <div className="admin-section-head">
          <div>
            <h2>Product catalog</h2>
            <p>{products.length} products in Google Sheets</p>
          </div>
          <button
            className="admin-button admin-button-primary"
            type="button"
            onClick={() => {
              setNotice("");
              setIsCreating(true);
              setEditing(null);
            }}
          >
            Add product
          </button>
        </div>

        {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
        {loadError ? <p className="admin-page-error" role="alert">{loadError}</p> : null}

        <div className="admin-filters" aria-label="Product filters">
          <label>
            University
            <select
              value={universityFilter}
              onChange={(event) =>
                setUniversityFilter(event.target.value as FilterUniversity)
              }
            >
              <option value="ALL">All universities</option>
              {adminUniversities.map((university) => (
                <option key={university} value={university}>{university}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as FilterStatus)
              }
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-product-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>University</th>
                <th>Price</th>
                <th>Sizes</th>
                <th>Status</th>
                <th>Order</th>
                <th><span className="admin-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.productId}>
                  <td>
                    <div className="admin-product-identity">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={product.imageUrl} alt="" />
                      <div>
                        <strong>{product.jerseyColor}</strong>
                        <span>{product.productId}</span>
                      </div>
                    </div>
                  </td>
                  <td>{product.university}</td>
                  <td>฿{formatPrice(product.priceThb)}</td>
                  <td>{product.availableSizes.join(", ")}</td>
                  <td>
                    <span className={product.active ? "admin-status active" : "admin-status inactive"}>
                      {product.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{product.sortOrder}</td>
                  <td>
                    <button
                      className="admin-edit-button"
                      type="button"
                      onClick={() => {
                        setNotice("");
                        setEditing(product);
                        setIsCreating(false);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loadError && filteredProducts.length === 0 ? (
            <p className="admin-empty">No products match these filters.</p>
          ) : null}
        </div>
      </section>

      {isCreating || editing ? (
        <ProductEditor
          product={editing ?? emptyProduct}
          created={isCreating}
          onCancel={closeEditor}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}

function ProductEditor({
  product,
  created,
  onCancel,
  onSaved
}: {
  product: AdminProduct;
  created: boolean;
  onCancel: () => void;
  onSaved: (product: AdminProduct, created: boolean) => void;
}) {
  const [draft, setDraft] = useState(product);
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function update<K extends keyof AdminProduct>(key: K, value: AdminProduct[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function toggleSize(size: string) {
    update(
      "availableSizes",
      draft.availableSizes.includes(size)
        ? draft.availableSizes.filter((value) => value !== size)
        : [...draft.availableSizes, size]
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage("");

    const formData = new FormData();
    formData.set("product", JSON.stringify(draft));
    if (image) formData.set("image", image);

    try {
      const endpoint = created
        ? "/api/admin/products"
        : `/api/admin/products/${encodeURIComponent(product.productId)}`;
      const response = await fetch(endpoint, {
        method: created ? "POST" : "PUT",
        body: formData
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
        product?: AdminProduct;
      };

      if (!response.ok || !result.ok || !result.product) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message || "Product could not be saved.");
        return;
      }

      onSaved(result.product, created);
    } catch {
      setMessage("Product could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-editor-backdrop" role="presentation">
      <section
        className="admin-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-editor-title"
      >
        <div className="admin-editor-head">
          <div>
            <p className="admin-eyebrow">{created ? "New product" : product.productId}</p>
            <h2 id="admin-editor-title">{created ? "Add product" : "Edit product"}</h2>
          </div>
          <button type="button" className="admin-close-button" onClick={onCancel} aria-label="Close editor">×</button>
        </div>

        <form className="admin-product-form" onSubmit={submit}>
          <Field label="Product ID" error={errors.productId}>
            <input
              value={draft.productId}
              onChange={(event) => update("productId", event.target.value)}
              disabled={!created}
              required
              placeholder="kg-bm-matcha"
            />
          </Field>

          <Field label="University" error={errors.university}>
            <select
              value={draft.university}
              onChange={(event) => update("university", event.target.value as AdminUniversity)}
            >
              {adminUniversities.map((university) => (
                <option key={university} value={university}>{university}</option>
              ))}
            </select>
          </Field>

          <Field label="Jersey color" error={errors.jerseyColor}>
            <input
              value={draft.jerseyColor}
              onChange={(event) => update("jerseyColor", event.target.value)}
              required
              placeholder="Mint Chocolate Chip"
            />
          </Field>

          <div className="admin-form-grid">
            <Field label="Price (THB)" error={errors.priceThb}>
              <input
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                value={draft.priceThb}
                onChange={(event) => update("priceThb", Number(event.target.value))}
                required
              />
            </Field>
            <Field label="Sort order" error={errors.sortOrder}>
              <input
                type="number"
                min="0"
                max="999999"
                step="1"
                value={draft.sortOrder}
                onChange={(event) => update("sortOrder", Number(event.target.value))}
                required
              />
            </Field>
          </div>

          <fieldset className="admin-size-fieldset">
            <legend>Available sizes</legend>
            <div className="admin-size-options">
              {adminProductSizes.map((size) => (
                <label key={size}>
                  <input
                    type="checkbox"
                    checked={draft.availableSizes.includes(size)}
                    onChange={() => toggleSize(size)}
                  />
                  <span>{size}</span>
                </label>
              ))}
            </div>
            {errors.availableSizes ? <small className="admin-field-error">{errors.availableSizes}</small> : null}
          </fieldset>

          <Field
            label={created ? "Product image" : "Replace product image (optional)"}
            error={errors.imageUrl || errors.image}
            hint="PNG, JPEG, or WEBP. Maximum 4 MB."
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required={created}
              onChange={(event) => setImage(event.target.files?.[0] ?? null)}
            />
          </Field>

          <label className="admin-active-toggle">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => update("active", event.target.checked)}
            />
            <span>
              <strong>Active on storefront</strong>
              <small>Inactive products remain in the sheet but cannot be purchased.</small>
            </span>
          </label>

          {message ? <p className="admin-page-error" role="alert">{message}</p> : null}

          <div className="admin-form-actions">
            <button type="button" className="admin-button admin-button-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" className="admin-button admin-button-primary" disabled={saving}>
              {saving ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  children
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <small className="admin-field-error">{error}</small> : null}
    </label>
  );
}

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price);
}
