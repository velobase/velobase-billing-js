import {
  VelobaseAuthenticationError,
  VelobaseConflictError,
  VelobaseError,
  VelobaseInternalError,
  VelobaseNotFoundError,
  VelobaseValidationError,
} from "./errors";

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Field names whose VALUE is a user-controlled dict whose KEYS are arbitrary
 * data (not API field names). Their contents must be passed through verbatim,
 * including any nested objects, because we have no way to tell which keys
 * inside are "schema" vs "data".
 *
 * Right now this is just `metadata: Record<string, unknown>`. Anything we
 * add here must satisfy the same property: the user picks the keys and the
 * value tree is opaque to us.
 */
const PRESERVE_VALUE_VERBATIM = new Set(["metadata"]);

/**
 * Field names whose VALUE is a dict where the IMMEDIATE child keys are
 * user-controlled business identifiers but whose grandchildren are still
 * structured API objects. We preserve the first-level keys but keep
 * recursing into the values.
 *
 * Example: `wallets: Record<string, WalletBalance>` — the wallet name
 * (e.g. `email_counter`) is data the user picked, but `WalletBalance` is
 * a structured shape whose `starts_at` etc. still need case-converting.
 */
const PRESERVE_IMMEDIATE_CHILD_KEYS = new Set(["wallets"]);

function convertKeys(
  obj: unknown,
  converter: (key: string) => string,
): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeys(item, converter));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const newKey = converter(key);
      if (PRESERVE_VALUE_VERBATIM.has(key)) {
        result[newKey] = value;
      } else if (
        PRESERVE_IMMEDIATE_CHILD_KEYS.has(key) &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        result[newKey] = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(
            ([dictKey, dictValue]) => [dictKey, convertKeys(dictValue, converter)],
          ),
        );
      } else {
        result[newKey] = convertKeys(value, converter);
      }
    }
    return result;
  }
  return obj;
}

export function toSnakeCaseKeys<T>(obj: T): unknown {
  return convertKeys(obj, toSnakeCase);
}

export function toCamelCaseKeys<T>(obj: T): unknown {
  return convertKeys(obj, toCamelCase);
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function throwForStatus(
  status: number,
  message: string,
  type: string,
): never {
  switch (status) {
    case 400:
      throw new VelobaseValidationError(message);
    case 401:
      throw new VelobaseAuthenticationError(message);
    case 404:
      throw new VelobaseNotFoundError(message);
    case 409:
      throw new VelobaseConflictError(message);
    case 500:
      throw new VelobaseInternalError(message);
    default:
      throw new VelobaseError(message, status, type);
  }
}

export class HttpClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private maxRetries: number;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout;
    this.maxRetries = opts.maxRetries;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
        await new Promise((r) => setTimeout(r, delay));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...headers,
          },
          body: body ? JSON.stringify(toSnakeCaseKeys(body)) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: { message?: string; type?: string };
          };
          const msg =
            json.error?.message ?? `HTTP ${res.status}`;
          const type = json.error?.type ?? "unknown_error";

          if (isRetryable(res.status) && attempt < this.maxRetries) {
            lastError = new VelobaseError(msg, res.status, type);
            continue;
          }

          throwForStatus(res.status, msg, type);
        }

        const json = await res.json();
        return toCamelCaseKeys(json) as T;
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof VelobaseError) {
          throw err;
        }

        lastError = err as Error;

        if (attempt < this.maxRetries) {
          continue;
        }

        throw new VelobaseError(
          `Request failed: ${lastError.message}`,
          0,
          "network_error",
        );
      }
    }

    throw lastError;
  }
}
