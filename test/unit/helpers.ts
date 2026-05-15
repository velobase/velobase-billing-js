import { vi, type Mock } from "vitest";

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockFetchHandle {
  fetch: Mock;
  /** Records every call made by the SDK in order. */
  calls: CapturedRequest[];
  /** Last captured request (convenience). */
  last: () => CapturedRequest;
}

/**
 * Installs a mock fetch on `globalThis.fetch` that returns the supplied
 * responses in order. Each response describes the JSON body and optional
 * status (defaults to 200).
 *
 * The handle exposes the recorded requests as already-parsed objects so tests
 * can make exact assertions on method, URL, headers, and body shape (in
 * snake_case, the way the wire actually sees them).
 */
export function installMockFetch(
  responses: Array<{ status?: number; body?: unknown }>,
): MockFetchHandle {
  const calls: CapturedRequest[] = [];
  let i = 0;

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const headers = normalizeHeaders(init.headers);
    let body: unknown = undefined;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body,
    });

    const next = responses[i++];
    if (!next) {
      throw new Error(
        `mock fetch ran out of responses (call #${i}); did you forget to enqueue one?`,
      );
    }
    const status = next.status ?? 200;
    const payload = JSON.stringify(next.body ?? {});
    return new Response(payload, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });

  // Cast to any: Response and fetch types from undici/lib.dom can clash.
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return {
    fetch: fetchMock,
    calls,
    last: () => {
      const last = calls[calls.length - 1];
      if (!last) throw new Error("no requests captured yet");
      return last;
    },
  };
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
  }
  return out;
}

/** Convenience: parse query string from a captured URL into a flat record. */
export function queryOf(url: string): Record<string, string> {
  const i = url.indexOf("?");
  if (i < 0) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(i + 1))) {
    out[k] = v;
  }
  return out;
}

/** Convenience: extract path (no query) from captured URL. */
export function pathOf(url: string): string {
  const i = url.indexOf("?");
  return i < 0 ? url : url.slice(0, i);
}
