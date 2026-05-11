export type KitErrorCode =
  | "INVALID_INPUT"
  | "ROUTE_UNAVAILABLE"
  | "INSUFFICIENT_BALANCE"
  | "GAS_ESTIMATION_FAILED"
  | "RATE_LIMITED"
  | "BACKEND_UNAVAILABLE"
  | "SETTLEMENT_TIMEOUT"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export interface KitErrorInit {
  retryable: boolean;
  cause?: unknown;
}

export class KitError extends Error {
  readonly code: KitErrorCode;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(code: KitErrorCode, message: string, init: KitErrorInit) {
    super(message);
    this.name = "KitError";
    this.code = code;
    this.retryable = init.retryable;
    this.cause = init.cause;
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof KitError && err.retryable;
}

interface BackendErr {
  status: number;
  body?: { code?: string; message?: string };
}

export function classify(err: BackendErr): KitError {
  if (err.status === 429) return new KitError("RATE_LIMITED", "rate limited", { retryable: true });
  if (err.status === 401 || err.status === 403)
    return new KitError("UNAUTHORIZED", "unauthorized", { retryable: false });
  if (err.status >= 500)
    return new KitError("BACKEND_UNAVAILABLE", err.body?.message ?? "backend error", { retryable: true });
  if (err.status === 400) {
    return new KitError("INVALID_INPUT", err.body?.message ?? "invalid input", { retryable: false });
  }
  return new KitError("UNKNOWN", `unexpected status ${err.status}`, { retryable: false });
}
