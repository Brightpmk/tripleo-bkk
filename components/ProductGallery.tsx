"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { productImagePlaceholder } from "@/lib/catalog";

/**
 * Product image gallery.
 *
 * Swiping is native CSS scroll-snap rather than a gallery library — it gives
 * real momentum on touch, costs no JavaScript, and degrades to a plain
 * scroller. The lightbox reuses the same scroller so behaviour is identical
 * full-screen.
 */

export function ProductGallery({
  images,
  alt
}: {
  images: string[];
  alt: string;
}) {
  const gallery = images.length > 0 ? images : [productImagePlaceholder];
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const next = Math.round(track.scrollLeft / track.clientWidth);
    setIndex((current) => (current === next ? current : next));
  }, []);

  function scrollTo(next: number) {
    const track = trackRef.current;
    const clamped = Math.max(0, Math.min(gallery.length - 1, next));

    setIndex(clamped);
    track?.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
  }

  return (
    <>
      <section className="gallery" aria-roledescription="carousel" aria-label="Product images">
        <div
          className="gallery-track"
          ref={trackRef}
          onScroll={onScroll}
          tabIndex={0}
          role="group"
          aria-label={`Image ${index + 1} of ${gallery.length}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              scrollTo(index + 1);
            }

            if (event.key === "ArrowLeft") {
              event.preventDefault();
              scrollTo(index - 1);
            }
          }}
        >
          {gallery.map((src, position) => (
            <button
              className="gallery-slide"
              key={`${src}-${position}`}
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`View image ${position + 1} of ${gallery.length} full screen`}
            >
              <GalleryImage
                src={src}
                alt={`${alt} — image ${position + 1} of ${gallery.length}`}
                // Only the cover is worth blocking first paint for.
                priority={position === 0}
              />
            </button>
          ))}
        </div>

        {gallery.length > 1 ? (
          <>
            <p className="gallery-counter" aria-hidden="true">
              {index + 1} / {gallery.length}
            </p>

            <div className="gallery-dots" role="tablist" aria-label="Choose image">
              {gallery.map((src, position) => (
                <button
                  key={`dot-${src}-${position}`}
                  type="button"
                  role="tab"
                  aria-selected={position === index}
                  aria-label={`Show image ${position + 1}`}
                  className={`gallery-dot${position === index ? " is-active" : ""}`}
                  onClick={() => scrollTo(position)}
                />
              ))}
            </div>

            {/* Desktop convenience; the scroller stays the source of truth. */}
            <div className="gallery-thumbs">
              {gallery.map((src, position) => (
                <button
                  key={`thumb-${src}-${position}`}
                  type="button"
                  className={`gallery-thumb${position === index ? " is-active" : ""}`}
                  onClick={() => scrollTo(position)}
                  aria-label={`Show image ${position + 1}`}
                >
                  <GalleryImage src={src} alt="" />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {lightboxOpen ? (
        <GalleryLightbox
          images={gallery}
          alt={alt}
          startIndex={index}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={scrollTo}
        />
      ) : null}
    </>
  );
}

function GalleryLightbox({
  images,
  alt,
  startIndex,
  onClose,
  onIndexChange
}: {
  images: string[];
  alt: string;
  startIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const trackRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Lock the page behind the overlay and restore it exactly on close.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = Math.max(0, Math.min(images.length - 1, current + delta));
        const track = trackRef.current;

        track?.scrollTo({
          left: next * track.clientWidth,
          behavior: "smooth"
        });

        return next;
      });
    },
    [images.length]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowRight") {
        move(1);
      }

      if (event.key === "ArrowLeft") {
        move(-1);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [move, onClose]);

  // Open on the slide the shopper was already looking at.
  useEffect(() => {
    const track = trackRef.current;

    if (track) {
      track.scrollLeft = startIndex * track.clientWidth;
    }
  }, [startIndex]);

  function syncClose() {
    onIndexChange(index);
    onClose();
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Product image viewer"
    >
      <div className="lightbox-bar">
        <span className="lightbox-counter">
          {index + 1} / {images.length}
        </span>
        <button
          className="lightbox-close"
          ref={closeRef}
          type="button"
          onClick={syncClose}
          aria-label="Close image viewer"
        >
          ×
        </button>
      </div>

      <div
        className="lightbox-track"
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget;
          setIndex(Math.round(track.scrollLeft / track.clientWidth));
        }}
      >
        {images.map((src, position) => (
          <div className="lightbox-slide" key={`light-${src}-${position}`}>
            <GalleryImage
              src={src}
              alt={`${alt} — image ${position + 1} of ${images.length}`}
              contain
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryImage({
  src,
  alt,
  priority = false,
  contain = false
}: {
  src: string;
  alt: string;
  priority?: boolean;
  contain?: boolean;
}) {
  const [resolved, setResolved] = useState(src || productImagePlaceholder);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      className={contain ? "is-contain" : undefined}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      // Stored images are capped at 1600px on the long edge.
      sizes="(min-width: 1024px) 560px, 100vw"
      onError={() => setResolved(productImagePlaceholder)}
    />
  );
}
