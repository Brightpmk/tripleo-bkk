import "server-only";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_TRACKED_SOURCES = 2_000;

type Attempt = {
  failures: number;
  resetAt: number;
};

const attempts = new Map<string, Attempt>();

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function getLoginSource(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function isLoginAllowed(source: string, now = Date.now()) {
  pruneAttempts(now);
  const attempt = attempts.get(source);
  return !attempt || attempt.resetAt <= now || attempt.failures < MAX_ATTEMPTS;
}

export function recordLoginFailure(source: string, now = Date.now()) {
  const current = attempts.get(source);

  if (!current || current.resetAt <= now) {
    attempts.set(source, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }

  current.failures += 1;
}

export function clearLoginFailures(source: string) {
  attempts.delete(source);
}

export function clearLoginRateLimitForTests() {
  attempts.clear();
}

function pruneAttempts(now: number) {
  for (const [source, attempt] of attempts) {
    if (attempt.resetAt <= now) {
      attempts.delete(source);
    }
  }

  while (attempts.size >= MAX_TRACKED_SOURCES) {
    const oldest = attempts.keys().next().value;
    if (typeof oldest !== "string") break;
    attempts.delete(oldest);
  }
}
