type ErrorLike = {
  code?: string;
  message?: string;
  name?: string;
  status?: number;
};

export type DiagnosticContext = {
  roomId?: string;
  discoveryId?: string;
  matchId?: string;
};

const KNOWN_PRODUCT_ERRORS = [
  /this room has ended/i,
  /this room is not open yet/i,
  /interest already sent/i,
  /this interaction is unavailable/i,
  /messaging is unavailable/i,
  /invalid login credentials/i,
  /passwords do not match/i,
  /password should be/i,
];

function errorLike(reason: unknown): ErrorLike {
  if (reason && typeof reason === "object") return reason as ErrorLike;
  return {};
}

export function isRateLimitError(reason: unknown) {
  const value = errorLike(reason);
  return value.status === 429
    || value.code === "over_request_rate_limit"
    || /rate limit|too many requests/i.test(value.message || "");
}

export function isNetworkError(reason: unknown) {
  const value = errorLike(reason);
  return typeof navigator !== "undefined" && !navigator.onLine
    || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(value.message || "");
}

export function userFacingError(reason: unknown, fallback: string, rateLimitMessage = "Too many people are joining at once. Please try again in a moment.") {
  const value = errorLike(reason);
  if (isRateLimitError(reason)) return rateLimitMessage;
  if (isNetworkError(reason)) return "Connection lost. Check your signal and try again.";
  if (value.code === "captcha_failed" || /captcha|security check/i.test(value.message || "")) {
    return "The quick security check expired. Please try it again.";
  }
  const safeMessage = value.message || "";
  if (KNOWN_PRODUCT_ERRORS.some((pattern) => pattern.test(safeMessage))) return safeMessage;
  return fallback;
}

export function logDiagnostic(operation: string, reason: unknown, context: DiagnosticContext = {}) {
  const value = errorLike(reason);
  console.error("[HERE operation failed]", {
    operation,
    code: value.code || value.name || "unknown",
    status: value.status || null,
    ...context,
    at: new Date().toISOString(),
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function retryRead<T>(
  operation: string,
  task: () => Promise<T>,
  context: DiagnosticContext = {},
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (reason) {
      lastError = reason;
      if (attempt + 1 >= attempts || isNetworkError(reason) || isRateLimitError(reason)) break;
      await delay(450 + Math.floor(Math.random() * 250));
    }
  }
  logDiagnostic(operation, lastError, context);
  throw lastError;
}
