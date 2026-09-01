"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import type { CartItem } from "@/lib/cart";
import type { UniversityId } from "@/lib/catalog";

/**
 * Cart state that survives navigation.
 *
 * The storefront used to hold the cart in StorefrontApp's own useState, which
 * meant routing to a real product page would unmount it and lose the cart.
 * This moves only *where* the cart lives — every pricing rule still comes
 * from lib/cart.ts and lib/pricing.ts, untouched.
 *
 * Backed by a small external store rather than an effect so React can
 * reconcile server and client renders itself: getServerSnapshot returns an
 * empty cart, and the browser reads localStorage on its first client render.
 */

const STORAGE_KEY = "tripleo.cart.v1";

export type CartSnapshot = {
  items: CartItem[];
  universityId: UniversityId | null;
};

const EMPTY_SNAPSHOT: CartSnapshot = { items: [], universityId: null };

let snapshot: CartSnapshot = EMPTY_SNAPSHOT;
let loadedFromStorage = false;
const listeners = new Set<() => void>();

function readStoredSnapshot(): CartSnapshot {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return EMPTY_SNAPSHOT;
    }

    const parsed = JSON.parse(stored) as Partial<CartSnapshot>;

    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      universityId:
        typeof parsed.universityId === "string"
          ? (parsed.universityId as UniversityId)
          : null
    };
  } catch {
    // Corrupt or unavailable storage: start empty rather than crash.
    return EMPTY_SNAPSHOT;
  }
}

/**
 * Must return a referentially stable value between changes, or React will
 * re-render forever — hence the cached `snapshot`.
 */
function getSnapshot(): CartSnapshot {
  if (!loadedFromStorage) {
    snapshot = readStoredSnapshot();
    loadedFromStorage = true;
  }

  return snapshot;
}

function getServerSnapshot(): CartSnapshot {
  return EMPTY_SNAPSHOT;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: CartSnapshot) {
  snapshot = next;
  loadedFromStorage = true;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota must never break checkout.
  }

  for (const listener of listeners) {
    listener();
  }
}

function resolve<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}

type CartContextValue = {
  items: CartItem[];
  setItems: Dispatch<SetStateAction<CartItem[]>>;
  universityId: UniversityId | null;
  setUniversityId: Dispatch<SetStateAction<UniversityId | null>>;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const setItems = useCallback<Dispatch<SetStateAction<CartItem[]>>>(
    (update) => {
      const latest = getSnapshot();
      commit({ ...latest, items: resolve(update, latest.items) });
    },
    []
  );

  const setUniversityId = useCallback<
    Dispatch<SetStateAction<UniversityId | null>>
  >((update) => {
    const latest = getSnapshot();
    commit({ ...latest, universityId: resolve(update, latest.universityId) });
  }, []);

  const clear = useCallback(() => {
    commit(EMPTY_SNAPSHOT);
  }, []);

  const value = useMemo(
    () => ({
      items: current.items,
      setItems,
      universityId: current.universityId,
      setUniversityId,
      clear
    }),
    [current.items, current.universityId, setItems, setUniversityId, clear]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used inside a CartProvider.");
  }

  return context;
}

/** Test-only: drops the in-memory snapshot so each case starts clean. */
export function resetCartStoreForTests() {
  snapshot = EMPTY_SNAPSHOT;
  loadedFromStorage = false;
  listeners.clear();
}
