import "server-only";

/**
 * Lightweight in-memory throttle for the public tracking lookup.
 *
 * Follows the same pattern as the admin login limiter: a fixed window per
 * source, with pruning and a hard cap on tracked sources so the map cannot
 * grow without bound. Best-effort by design — on serverless this is per
 * instance, which is enough to blunt casual scraping without adding
 * infrastructure or a CAPTCHA.
 */

const WINDOW_MS = 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 20;
const MAX_TRACKED_SOURCES = 5_000;

type Window = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, Window>();

export function isTrackingLookupAllowed(source: string, now = Date.now()) {
  prune(now);

  const current = windows.get(source);

  if (!current || current.resetAt <= now) {
    windows.set(source, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (current.count >= MAX_LOOKUPS_PER_WINDOW) {
    return false;
  }

  current.count += 1;
  return true;
}

export function clearTrackingRateLimitForTests() {
  windows.clear();
}

function prune(now: number) {
  for (const [source, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(source);
    }
  }

  while (windows.size >= MAX_TRACKED_SOURCES) {
    const oldest = windows.keys().next().value;

    if (typeof oldest !== "string") {
      break;
    }

    windows.delete(oldest);
  }
}
