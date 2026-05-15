import { describe, expect, it, vi } from "vitest";
import {
  HttpClient,
  toCamelCaseKeys,
  toSnakeCaseKeys,
} from "../../src/http";
import { VelobaseError } from "../../src/errors";
import { installMockFetch } from "./helpers";

const DEFAULTS = {
  baseUrl: "https://api.example.com",
  apiKey: "vb_test_key",
  timeout: 5_000,
  maxRetries: 0,
};

describe("case conversion helpers", () => {
  it("snake_case converter walks nested objects and arrays", () => {
    const input = {
      customerId: "abc",
      isIdempotentReplay: false,
      nested: { walletKey: "default", subList: [{ resourceId: "r" }] },
    };
    expect(toSnakeCaseKeys(input)).toEqual({
      customer_id: "abc",
      is_idempotent_replay: false,
      nested: { wallet_key: "default", sub_list: [{ resource_id: "r" }] },
    });
  });

  it("camelCase converter walks nested objects and arrays", () => {
    const input = {
      customer_id: "abc",
      is_idempotent_replay: false,
      nested: { wallet_key: "default", sub_list: [{ resource_id: "r" }] },
    };
    expect(toCamelCaseKeys(input)).toEqual({
      customerId: "abc",
      isIdempotentReplay: false,
      nested: { walletKey: "default", subList: [{ resourceId: "r" }] },
    });
  });

  it("leaves primitives untouched", () => {
    expect(toSnakeCaseKeys("hello")).toBe("hello");
    expect(toSnakeCaseKeys(42)).toBe(42);
    expect(toSnakeCaseKeys(null)).toBe(null);
  });
});

describe("HttpClient request construction", () => {
  it("sends Bearer auth, JSON content type, and snake_case body", async () => {
    const { calls } = installMockFetch([{ body: { ok: true } }]);
    const http = new HttpClient(DEFAULTS);
    await http.request("POST", "/v1/test", {
      customerId: "cust_1",
      walletKey: "default",
    });

    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url).toBe("https://api.example.com/v1/test");
    expect(c.headers["authorization"]).toBe("Bearer vb_test_key");
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.body).toEqual({ customer_id: "cust_1", wallet_key: "default" });
  });

  it("strips trailing slashes from baseUrl", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    const http = new HttpClient({ ...DEFAULTS, baseUrl: "https://api.example.com//" });
    await http.request("GET", "/v1/x");
    expect(calls[0]!.url).toBe("https://api.example.com/v1/x");
  });

  it("does not attach a body on GET", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    const http = new HttpClient(DEFAULTS);
    await http.request("GET", "/v1/x");
    expect(calls[0]!.body).toBeUndefined();
  });

  it("merges custom headers (e.g. Idempotency-Key) without dropping defaults", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    const http = new HttpClient(DEFAULTS);
    await http.request("POST", "/v1/x", { a: 1 }, { "Idempotency-Key": "key-1" });
    const h = calls[0]!.headers;
    expect(h["authorization"]).toBe("Bearer vb_test_key");
    expect(h["content-type"]).toBe("application/json");
    expect(h["idempotency-key"]).toBe("key-1");
  });

  it("parses response bodies into camelCase", async () => {
    installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          frozen_amount: 100,
          is_idempotent_replay: false,
          freeze_details: [{ source_key: "default" }],
        },
      },
    ]);
    const http = new HttpClient(DEFAULTS);
    const res = await http.request<{
      transactionId: string;
      frozenAmount: number;
      isIdempotentReplay: boolean;
      freezeDetails: { sourceKey: string }[];
    }>("POST", "/v1/x", { transactionId: "txn_1" });

    expect(res).toEqual({
      transactionId: "txn_1",
      frozenAmount: 100,
      isIdempotentReplay: false,
      freezeDetails: [{ sourceKey: "default" }],
    });
  });
});

describe("HttpClient error mapping", () => {
  // All non-2xx responses produce a single VelobaseError instance carrying
  // the server's stable `code`/`type` verbatim. Consumers branch on
  // `err.code` (or `err.isType(...)` for coarse handling), never on
  // `instanceof <SubClass>` (which no longer exists).
  it.each([
    { status: 400, code: "amount_must_be_positive", type: "bad_request" },
    { status: 401, code: "invalid_api_key", type: "auth_error" },
    { status: 404, code: "customer_not_found", type: "not_found" },
    { status: 409, code: "transaction_conflict", type: "conflict" },
    { status: 429, code: "usage_limit_exceeded", type: "rate_limited" },
    { status: 500, code: "server_error", type: "server_error" },
  ])("propagates server code/type for HTTP $status", async ({ status, code, type }) => {
    installMockFetch([
      {
        status,
        body: {
          error: {
            code,
            type,
            message: `boom-${status}`,
            details: { hint: "x" },
            retryable: status >= 500,
            request_id: "req_test_1",
          },
        },
      },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      name: "VelobaseError",
      status,
      code,
      type,
      message: `boom-${status}`,
      details: { hint: "x" },
      retryable: status >= 500,
      requestId: "req_test_1",
    });
  });

  it("falls back to status-derived type when server omits type", async () => {
    installMockFetch([
      { status: 404, body: { error: { code: "customer_not_found", message: "nope" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      status: 404,
      code: "customer_not_found",
      type: "not_found",
    });
  });

  it("falls back to type as code when server omits code", async () => {
    installMockFetch([
      { status: 418, body: { error: { type: "bad_request", message: "I'm a teapot" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      status: 418,
      type: "bad_request",
      code: "bad_request",
      message: "I'm a teapot",
    });
  });

  it("threads request_id through, also from X-Request-Id header fallback", async () => {
    installMockFetch([
      {
        status: 400,
        body: { error: { code: "amount_must_be_positive" } },
        headers: { "x-request-id": "req_from_header" },
      },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    try {
      await http.request("POST", "/v1/x", { a: 1 });
    } catch (err) {
      expect(err).toBeInstanceOf(VelobaseError);
      expect((err as VelobaseError).requestId).toBe("req_from_header");
    }
  });

  it("falls back to HTTP <status> when no error body present", async () => {
    installMockFetch([{ status: 400, body: {} }]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toThrow("HTTP 400");
  });
});

describe("HttpClient retry logic", () => {
  it("retries 5xx responses up to maxRetries, then throws the mapped error", async () => {
    vi.useFakeTimers();
    try {
      const handle = installMockFetch([
        { status: 503, body: { error: { message: "down", type: "server_error" } } },
        { status: 503, body: { error: { message: "still down", type: "server_error" } } },
        { status: 200, body: { ok: true } },
      ]);
      const http = new HttpClient({ ...DEFAULTS, maxRetries: 2 });
      const p = http.request<{ ok: boolean }>("GET", "/v1/x");
      // Run backoff timers.
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.ok).toBe(true);
      expect(handle.calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries 429 responses", async () => {
    vi.useFakeTimers();
    try {
      const handle = installMockFetch([
        { status: 429, body: { error: { message: "slow down", type: "rate_limit" } } },
        { status: 200, body: { ok: true } },
      ]);
      const http = new HttpClient({ ...DEFAULTS, maxRetries: 1 });
      const p = http.request<{ ok: boolean }>("GET", "/v1/x");
      await vi.runAllTimersAsync();
      await p;
      expect(handle.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry 4xx (non-429) errors", async () => {
    const handle = installMockFetch([
      { status: 400, body: { error: { code: "amount_must_be_positive", type: "bad_request" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 3 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      name: "VelobaseError",
      status: 400,
      code: "amount_must_be_positive",
    });
    expect(handle.calls).toHaveLength(1);
  });

  it("wraps network errors as VelobaseError(network_error) with retryable=true", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      name: "VelobaseError",
      status: 0,
      code: "network_error",
      type: "upstream_error",
      retryable: true,
    });
  });
});
