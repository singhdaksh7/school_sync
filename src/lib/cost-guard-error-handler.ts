/**
 * Cost Guard and Authentication error mapping helper (PART 12 / 16).
 * Safely parses backend response codes, maps them to clean user-friendly messages,
 * extracts Retry-After headers/payloads, and ensures no PII or Redis keys are leaked.
 */

export interface CostGuardErrorResult {
  message: string;
  code: string;
  retryAfterSeconds: number | null;
}

/** Loose shape of a Cost Guard / auth error JSON body — every field is optional since the actual response is parsed JSON of unknown shape. */
interface CostGuardErrorBody {
  error?: string;
  code?: string;
  retryAfterSeconds?: number | string | null;
}

function isCostGuardErrorBody(value: unknown): value is CostGuardErrorBody {
  return typeof value === "object" && value !== null;
}

export function parseCostGuardError(
  response: Response,
  body: unknown
): CostGuardErrorResult {
  const parsedBody: CostGuardErrorBody = isCostGuardErrorBody(body) ? body : {};

  // 1. Extract Retry-After details
  let retryAfterSeconds: number | null = null;
  const headerValue = response.headers.get("Retry-After");
  if (headerValue) {
    const parsed = parseInt(headerValue, 10);
    if (!isNaN(parsed)) retryAfterSeconds = parsed;
  }
  if (parsedBody.retryAfterSeconds !== undefined && parsedBody.retryAfterSeconds !== null) {
    retryAfterSeconds = Number(parsedBody.retryAfterSeconds);
  }

  // 2. Identify code
  const code = parsedBody.code || (response.status === 429 ? "RATE_LIMITED" : "UNKNOWN_ERROR");

  // 3. Map to clean message
  let message = parsedBody.error || "An unexpected error occurred.";

  switch (code) {
    case "RATE_LIMITED":
      message = retryAfterSeconds
        ? `Too many requests. Please retry after ${retryAfterSeconds} seconds.`
        : "Too many requests. Please try again in a few moments.";
      break;

    case "UPLOAD_QUOTA_EXCEEDED":
      message = "The upload quota for this resource has been exceeded. Please delete old files or contact support.";
      break;

    case "NEW_LOGIN_LIMIT_REACHED":
      message = retryAfterSeconds
        ? `Too many new sign-ins. Please try again after ${retryAfterSeconds} seconds.`
        : "Too many new sign-ins. Please try again in a few moments.";
      break;

    case "AUTH_COOLDOWN_ACTIVE":
      message = retryAfterSeconds
        ? `Too many failed password attempts. Access is locked for another ${retryAfterSeconds} seconds.`
        : "Too many failed password attempts. Cooldown active. Please try again later.";
      break;

    case "AUTH_TEMPORARILY_LOCKED":
      message = retryAfterSeconds
        ? `This account has been temporarily locked due to excessive failed attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`
        : "This account has been temporarily locked. Please try again later.";
      break;

    case "SESSION_REVOKED":
    case "REVOKED":
      message = "Your session has been revoked. Please sign in again.";
      break;

    case "SESSION_EXPIRED":
    case "EXPIRED":
      message = "Your session has expired due to inactivity. Please sign in again.";
      break;

    case "FEATURE_UNAVAILABLE":
      message = "This feature is currently unavailable on your current school subscription plan.";
      break;

    case "SCHOOL_SUSPENDED":
    case "SUSPENDED":
      message = "This school's access is suspended. Please contact the administrator.";
      break;

    case "SCHOOL_EXPIRED":
      message = "This school's subscription has expired. Please contact the administrator.";
      break;
  }

  return {
    message,
    code,
    retryAfterSeconds,
  };
}
