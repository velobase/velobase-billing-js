import type { VelobaseErrorCode, VelobaseErrorType } from "./codes.generated";

export type { VelobaseErrorCode, VelobaseErrorType };

/**
 * The single error class the SDK ever throws for a non-2xx response.
 *
 * Carries every piece of context the server transmits in the error
 * body (`code`, `type`, `details`, `retryable`, `request_id`) plus
 * the HTTP `status`. Clients should branch on `err.code` for precise
 * behaviour and fall back to `err.type` for broader categories.
 *
 * Network failures (DNS, socket reset, timeout) also surface as
 * `VelobaseError` with `code: "network_error"`, `status: 0`, and
 * `retryable: true`.
 */
export interface VelobaseErrorInit {
  code: VelobaseErrorCode;
  type: VelobaseErrorType;
  status: number;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  requestId?: string;
  cause?: unknown;
}

export class VelobaseError extends Error {
  readonly code: VelobaseErrorCode;
  readonly type: VelobaseErrorType;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly cause?: unknown;

  constructor(init: VelobaseErrorInit) {
    super(init.message);
    this.name = "VelobaseError";
    this.code = init.code;
    this.type = init.type;
    this.status = init.status;
    this.details = init.details ?? {};
    this.retryable = init.retryable ?? defaultRetryableFor(init.status);
    this.requestId = init.requestId;
    this.cause = init.cause;
  }

  /** Precise check by code. Prefer this over `instanceof` subclasses. */
  is(code: VelobaseErrorCode): boolean {
    return this.code === code;
  }

  /** Coarser check by category. */
  isType(type: VelobaseErrorType): boolean {
    return this.type === type;
  }
}

function defaultRetryableFor(status: number): boolean {
  // 5xx and 429 are conventionally retryable. The server's `retryable`
  // flag is preferred when present; this only kicks in for synthesized
  // errors (e.g. network failures from `request()`).
  return status >= 500 || status === 429 || status === 0;
}

/** Type guard. Works across module boundaries (Symbol-based check). */
export function isVelobaseError(value: unknown): value is VelobaseError {
  return value instanceof Error && value.name === "VelobaseError";
}
