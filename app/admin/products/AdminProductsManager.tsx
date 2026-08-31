"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AdminShell } from "../AdminShell";
import {
  adminProductSizes,
  adminUniversities,
  getUniversityLabel,
  type AdminProduct,
  type AdminUniversity
} from "@/lib/admin-products";

type AdminNotice = { tone: "success" | "warning"; text: string };

type FilterUniversity = AdminUniversity | "ALL";
type FilterStatus = "ALL" | "ACTIVE" | "INACTIVE";

const emptyProduct: AdminProduct = {
  productId: "",
  university: adminUniversities[0],
  shirtColor: "",
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
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [universityFilter, setUniversityFilter] =
    useState<FilterUniversity>("ALL");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter(
      (product) =>
        (universityFilter === "ALL" ||
          product.university === universityFilter) &&
        (statusFilter === "ALL" ||
          (statusFilter === "ACTIVE" ? product.active : !product.active)) &&
        (query === "" ||
          product.shirtColor.toLowerCase().includes(query) ||
          product.productId.toLowerCase().includes(query))
    );
  }, [products, search, statusFilter, universityFilter]);

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
    setNotice({
      tone: "success",
      text: created ? "Product created." : "Product updated."
    });
    closeEditor();
  }

  function handleDeleted(product: AdminProduct, imageCleanup: string) {
    setProducts((current) =>
      current.filter((item) => item.productId !== product.productId)
    );
    setNotice(
      imageCleanup === "failed"
        ? {
            tone: "warning",
            text: `"${product.shirtColor}" was deleted, but its image could not be removed from storage. It can be cleaned up manually later.`
          }
        : {
            tone: "success",
            text: `"${product.shirtColor}" was permanently deleted.`
          }
    );
    closeEditor();
  }

  return (
    <AdminShell title="Products">
      <section className="admin-content">
        <div className="admin-section-head">
          <div>
            <h2>Product catalog</h2>
            <p>{products.length} products in Supabase</p>
          </div>
          <button
            className="admin-button admin-button-primary"
            type="button"
            onClick={() => {
              setNotice(null);
              setIsCreating(true);
              setEditing(null);
            }}
          >
            Add product
          </button>
        </div>

        {notice ? (
          <p
            className={
              notice.tone === "warning" ? "admin-warning" : "admin-notice"
            }
            role="status"
          >
            {notice.text}
          </p>
        ) : null}
        {loadError ? (
          <p className="admin-page-error" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="admin-filters">
          <label htmlFor="admin-search">
            Search
            <input
              id="admin-search"
              type="search"
              inputMode="search"
              placeholder="Colour or product ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label htmlFor="admin-filter-university">
            University
            <select
              id="admin-filter-university"
              value={universityFilter}
              onChange={(event) =>
                setUniversityFilter(event.target.value as FilterUniversity)
              }
            >
              <option value="ALL">All universities</option>
              {adminUniversities.map((university) => (
                <option key={university} value={university}>
                  {getUniversityLabel(university)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="admin-filter-status">
            Status
            <select
              id="admin-filter-status"
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

        <p className="admin-result-count" role="status">
          Showing {filteredProducts.length} of {products.length}
        </p>

        <div className="admin-table-wrap">
          <table className="admin-product-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Product</th>
                <th role="columnheader" scope="col">University</th>
                <th role="columnheader" scope="col">Price</th>
                <th role="columnheader" scope="col">Sizes</th>
                <th role="columnheader" scope="col">Status</th>
                <th role="columnheader" scope="col">Order</th>
                <th role="columnheader" scope="col">
                  <span className="admin-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {filteredProducts.map((product) => (
                <tr key={product.productId} role="row">
                  <td className="admin-cell-identity" role="cell">
                    <div className="admin-product-identity">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={product.imageUrl} alt="" loading="lazy" />
                      <div>
                        <strong>{product.shirtColor}</strong>
                        <span>{product.productId}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="University" role="cell">
                    {getUniversityLabel(product.university)}
                  </td>
                  <td data-label="Price" role="cell">
                    ฿{formatPrice(product.priceThb)}
                  </td>
                  <td className="admin-cell-sizes" data-label="Sizes" role="cell">
                    {product.availableSizes.join(", ")}
                  </td>
                  <td data-label="Status" role="cell">
                    <span
                      className={
                        product.active
                          ? "admin-status active"
                          : "admin-status inactive"
                      }
                    >
                      {product.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td data-label="Order" role="cell">
                    {product.sortOrder}
                  </td>
                  <td className="admin-cell-actions" role="cell">
                    <button
                      className="admin-row-edit"
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setEditing(product);
                        setIsCreating(false);
                      }}
                    >
                      Edit
                      <span className="admin-sr-only">
                        {" "}
                        {product.shirtColor || product.productId}
                      </span>
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
          onDeleted={handleDeleted}
        />
      ) : null}
    </AdminShell>
  );
}

function ProductEditor({
  product,
  created,
  onCancel,
  onSaved,
  onDeleted
}: {
  product: AdminProduct;
  created: boolean;
  onCancel: () => void;
  onSaved: (product: AdminProduct, created: boolean) => void;
  onDeleted: (product: AdminProduct, imageCleanup: string) => void;
}) {
  const [draft, setDraft] = useState(product);
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const busy = saving || deleting;

  // Lock the page behind the drawer and move focus into it — once.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) {
        return;
      }

      // Escape backs out of the confirmation first, not the whole editor.
      if (confirmingDelete) {
        setConfirmingDelete(false);
        return;
      }

      onCancel();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, confirmingDelete, onCancel]);

  async function deleteProduct() {
    setDeleting(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${encodeURIComponent(product.productId)}`,
        { method: "DELETE" }
      );
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        imageCleanup?: string;
      };

      if (!response.ok || !result.ok) {
        setConfirmingDelete(false);
        setMessage(result.message || "Product could not be deleted.");
        return;
      }

      onDeleted(product, result.imageCleanup ?? "skipped");
    } catch {
      setConfirmingDelete(false);
      setMessage("Product could not be deleted. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

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
    <div
      className="admin-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <section
        className="admin-editor"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-editor-title"
      >
        <div className="admin-editor-head">
          <div>
            <p className="admin-eyebrow">
              {created ? "New product" : product.productId}
            </p>
            <h2 id="admin-editor-title">
              {created ? "Add product" : "Edit product"}
            </h2>
          </div>
          <button
            type="button"
            className="admin-close-button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close editor"
          >
            ×
          </button>
        </div>

        <form className="admin-product-form" onSubmit={submit}>
          <div className="admin-form-body">
            <Field label="Product ID" error={errors.productId}>
              <input
                value={draft.productId}
                onChange={(event) => update("productId", event.target.value)}
                disabled={!created}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="kg-bm-matcha"
              />
            </Field>

            <Field label="University" error={errors.university}>
              <select
                value={draft.university}
                onChange={(event) =>
                  update("university", event.target.value as AdminUniversity)
                }
              >
                {adminUniversities.map((university) => (
                  <option key={university} value={university}>
                    {getUniversityLabel(university)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Shirt color" error={errors.shirtColor}>
              <input
                value={draft.shirtColor}
                onChange={(event) => update("shirtColor", event.target.value)}
                required
                placeholder="Mint Chocolate Chip"
              />
            </Field>

            <div className="admin-form-grid">
              <Field label="Price (THB)" error={errors.priceThb}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={draft.priceThb}
                  onChange={(event) =>
                    update("priceThb", Number(event.target.value))
                  }
                  required
                />
              </Field>
              <Field label="Sort order" error={errors.sortOrder}>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999999"
                  step="1"
                  value={draft.sortOrder}
                  onChange={(event) =>
                    update("sortOrder", Number(event.target.value))
                  }
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
              {errors.availableSizes ? (
                <small className="admin-field-error">
                  {errors.availableSizes}
                </small>
              ) : null}
            </fieldset>

            <Field
              label={created ? "Product image" : "Replace image (optional)"}
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
                <small>
                  Inactive products stay saved but cannot be purchased.
                </small>
              </span>
            </label>

            {message ? (
              <p className="admin-page-error" role="alert">
                {message}
              </p>
            ) : null}
          </div>

          <div className="admin-form-actions">
            {created ? null : (
              <button
                type="button"
                className="admin-delete-link"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                Delete product
              </button>
            )}
            <span className="admin-form-actions-spacer" />
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="admin-button admin-button-primary"
              disabled={busy}
            >
              {saving ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      </section>

      {confirmingDelete ? (
        <DeleteConfirmation
          product={product}
          deleting={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={deleteProduct}
        />
      ) : null}
    </div>
  );
}

function DeleteConfirmation({
  product,
  deleting,
  onCancel,
  onConfirm
}: {
  product: AdminProduct;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="admin-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) {
          onCancel();
        }
      }}
    >
      <div
        className="admin-confirm"
        ref={confirmRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-copy"
      >
        <h2 id="admin-confirm-title">Delete this product?</h2>
        <p id="admin-confirm-copy">
          This permanently removes the product from the product database. This
          action cannot be undone.
        </p>

        <dl className="admin-confirm-facts">
          <div>
            <dt>Product ID</dt>
            <dd>{product.productId}</dd>
          </div>
          <div>
            <dt>University</dt>
            <dd>{getUniversityLabel(product.university)}</dd>
          </div>
          <div>
            <dt>Shirt color</dt>
            <dd>{product.shirtColor}</dd>
          </div>
        </dl>

        <p className="admin-confirm-note">
          Past orders keep their own record of this shirt and are not affected.
        </p>

        <div className="admin-confirm-actions">
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-button admin-button-danger"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete product"}
          </button>
        </div>
      </div>
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
