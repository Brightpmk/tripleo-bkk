import "server-only";

/**
 * Phase timing for the order submission critical path.
 *
 * Deliberately records only durations and byte counts — never customer
 * names, phone numbers, addresses, cart contents, file names, tokens, or
 * credentials. The order ID is included so a slow request can be correlated
 * with the rows it wrote; it is already present in this module's error logs.
 */
export type PhaseTimer = {
  mark: (phase: string) => void;
  /** Times a promise and records it under `phase`, preserving rejections. */
  track: <T>(phase: string, work: Promise<T>) => Promise<T>;
  totalMs: () => number;
  phases: () => Record<string, number>;
};

export function createPhaseTimer(): PhaseTimer {
  const startedAt = performance.now();
  let lastMark = startedAt;
  const phases: Record<string, number> = {};

  return {
    mark(phase) {
      const now = performance.now();
      phases[phase] = round(now - lastMark);
      lastMark = now;
    },
    async track(phase, work) {
      const startedPhaseAt = performance.now();

      try {
        return await work;
      } finally {
        phases[phase] = round(performance.now() - startedPhaseAt);
      }
    },
    totalMs() {
      return round(performance.now() - startedAt);
    },
    phases() {
      return { ...phases };
    }
  };
}

export function logOrderTiming(
  timer: PhaseTimer,
  context: { orderId?: string; slipBytes?: number; outcome: string }
) {
  if (process.env.ORDER_TIMING_LOGS === "off") {
    return;
  }

  console.info("Order submission timing", {
    ...context,
    totalMs: timer.totalMs(),
    ...timer.phases()
  });
}

function round(value: number) {
  return Math.round(value);
}
