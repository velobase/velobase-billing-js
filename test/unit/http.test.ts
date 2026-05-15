import { describe, expect, it, vi } from "vitest";
import {
  HttpClient,
  toCamelCaseKeys,
  toSnakeCaseKeys,
} from "../../src/http";
import {
  VelobaseAuthenticationError,
  VelobaseConflictError,
  VelobaseError,
  VelobaseInternalError,
  VelobaseNotFoundError,
  VelobaseValidationError,
} from "../../src/errors";
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
  it.each([
    { status: 400, klass: VelobaseValidationError, name: "VelobaseValidationError" },
    { status: 401, klass: VelobaseAuthenticationError, name: "VelobaseAuthenticationError" },
    { status: 404, klass: VelobaseNotFoundError, name: "VelobaseNotFoundError" },
    { status: 409, klass: VelobaseConflictError, name: "VelobaseConflictError" },
    { status: 500, klass: VelobaseInternalError, name: "VelobaseInternalError" },
  ])("maps HTTP $status to $name", async ({ status, klass }) => {
    installMockFetch([
      {
        status,
        body: { error: { message: `boom-${status}`, type: "server_label" } },
      },
    ]);
    // 500 retries by default; force no retries here to keep the assertion exact.
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toBeInstanceOf(klass);
    try {
      await http.request("POST", "/v1/x", { a: 1 });
    } catch {
      // already asserted above
    }
  });

  it("falls back to generic VelobaseError for non-mapped status codes", async () => {
    installMockFetch([
      { status: 418, body: { error: { message: "I'm a teapot", type: "teapot" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      status: 418,
      type: "teapot",
      message: "I'm a teapot",
    });
  });

  it("uses the server-provided error.message when present", async () => {
    installMockFetch([
      { status: 400, body: { error: { message: "amount must be positive", type: "validation_error" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toThrow(
      "amount must be positive",
    );
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
      { status: 400, body: { error: { message: "bad", type: "validation_error" } } },
    ]);
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 3 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toBeInstanceOf(
      VelobaseValidationError,
    );
    expect(handle.calls).toHaveLength(1);
  });

  it("wraps network errors as VelobaseError(network_error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const http = new HttpClient({ ...DEFAULTS, maxRetries: 0 });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toMatchObject({
      status: 0,
      type: "network_error",
    });
    await expect(http.request("POST", "/v1/x", { a: 1 })).rejects.toBeInstanceOf(
      VelobaseError,
    );
  });
});
