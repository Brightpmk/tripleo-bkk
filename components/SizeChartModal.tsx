"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import {
  sizeChartGroups,
  type SizeChartStyle
} from "@/lib/size-charts";

export function SizeChartModal({ className = "" }: { className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [activeStyle, setActiveStyle] = useState<SizeChartStyle>("boxy");

  const activeGroup =
    sizeChartGroups.find((group) => group.id === activeStyle) ??
    sizeChartGroups[0];

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`size-chart-trigger${className ? ` ${className}` : ""}`}
        type="button"
        onClick={openDialog}
      >
        Size chart
      </button>

      <dialog
        ref={dialogRef}
        className="size-chart-dialog"
        aria-labelledby="size-chart-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
        onClose={() => triggerRef.current?.focus()}
      >
        <div className="size-chart-shell">
          <header className="size-chart-header">
            <div>
              <p className="eyebrow">Measurements in inches</p>
              <h2 id="size-chart-title">Size chart</h2>
            </div>
            <button
              className="size-chart-close"
              type="button"
              aria-label="Close size chart"
              onClick={closeDialog}
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </header>

          <div className="size-chart-body">
            <div
              className="size-chart-tabs"
              role="tablist"
              aria-label="Boxy Tee style"
            >
              {sizeChartGroups.map((group) => (
                <button
                  id={`size-chart-tab-${group.id}`}
                  key={group.id}
                  className="size-chart-tab"
                  type="button"
                  role="tab"
                  aria-controls={`size-chart-panel-${group.id}`}
                  aria-selected={activeStyle === group.id}
                  onClick={() => setActiveStyle(group.id)}
                >
                  <span>{group.label}</span>
                  <small>{group.sizeRange}</small>
                </button>
              ))}
            </div>

            <section
              id={`size-chart-panel-${activeGroup.id}`}
              className="size-chart-panel"
              role="tabpanel"
              aria-labelledby={`size-chart-tab-${activeGroup.id}`}
            >
              <div className="size-chart-gallery">
                {activeGroup.images.map((image) => (
                  <figure className="size-chart-figure" key={image.src}>
                    <Image
                      src={image.src}
                      alt={image.alt}
                      width={1080}
                      height={1350}
                      sizes="(max-width: 639px) 88vw, (max-width: 999px) 42vw, 280px"
                    />
                    <figcaption>{image.collection}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          </div>

          <footer className="size-chart-footer">
            <span>{activeGroup.images.length} collection references</span>
            <button className="btn btn-primary btn-sm" type="button" onClick={closeDialog}>
              Done
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
}
