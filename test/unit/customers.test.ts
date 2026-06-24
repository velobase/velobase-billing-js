import { describe, expect, it } from "vitest";
import { Velobase } from "../../src/client";
import { installMockFetch, pathOf, queryOf } from "./helpers";

const BASE = "https://api.example.com";

function client() {
  return new Velobase({
    apiKey: "vb_test",
    baseUrl: BASE,
    timeout: 5_000,
    maxRetries: 0,
  });
}

describe("Velobase constructor", () => {
  it("throws synchronously when apiKey is empty", () => {
    expect(() => new Velobase({ apiKey: "" })).toThrowError(/apiKey is required/);
  });

  it("falls back to default baseUrl when omitted", async () => {
    const { calls } = installMockFetch([{ body: makeCustomer("c1") }]);
    const vb = new Velobase({ apiKey: "vb_test" });
    await vb.customers.get("c1");
    expect(calls[0]!.url.startsWith("https://api.velobase.io/")).toBe(true);
  });
});

describe("customers.deposit", () => {
  it("POSTs /v1/customers/deposit with snake_case body", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          customer_id: "c1",
          account_id: "acc_1",
          wallet: "default",
          source: "admin_grant",
          total_amount: 1000,
          added_amount: 1000,
          starts_at: null,
          expires_at: null,
          record_id: "rec_1",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().customers.deposit({
      customerId: "c1",
      amount: 1000,
      wallet: "default",
      source: "admin_grant",
      description: "topup",
    });

    expect(calls[0]!.method).toBe("POST");
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/customers/deposit`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      amount: 1000,
      wallet: "default",
      source: "admin_grant",
      description: "topup",
    });
    expect(res.addedAmount).toBe(1000);
    expect(res.wallet).toBe("default");
    expect(res.source).toBe("admin_grant");
    expect(res.isIdempotentReplay).toBe(false);
  });

  it("attaches Idempotency-Key header when idempotencyKey is provided", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    await client().customers.deposit({
      customerId: "c1",
      amount: 100,
      idempotencyKey: "dep-1",
    });
    expect(calls[0]!.headers["idempotency-key"]).toBe("dep-1");
    // Body still carries idempotencyKey snake-cased; that's fine for the server
    // to read either place.
    expect(calls[0]!.body).toMatchObject({ idempotency_key: "dep-1" });
  });

  it("maps deprecated creditType to wallet on the wire", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    await client().customers.deposit({
      customerId: "c1",
      amount: 100,
      creditType: "legacy_bonus",
    });
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      amount: 100,
      wallet: "legacy_bonus",
    });
  });

  it("omits Idempotency-Key header when not provided", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    await client().customers.deposit({ customerId: "c1", amount: 100 });
    expect(calls[0]!.headers["idempotency-key"]).toBeUndefined();
  });
});

describe("customers.get", () => {
  it("GETs /v1/customers/<id> with URL-encoded id", async () => {
    const { calls } = installMockFetch([{ body: makeCustomer("user+1@example.com") }]);
    await client().customers.get("user+1@example.com");

    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(
      `${BASE}/v1/customers/${encodeURIComponent("user+1@example.com")}`,
    );
  });

  it("parses v2 wallet/sources shape (single-word wallet keys)", async () => {
    installMockFetch([
      {
        body: {
          id: "c1",
          name: null,
          email: null,
          metadata: null,
          wallets: {
            default: {
              total: 1500,
              used: 600,
              frozen: 0,
              available: 900,
              sources: [
                {
                  source: "admin_grant",
                  total: 1000,
                  used: 600,
                  frozen: 0,
                  available: 400,
                  starts_at: null,
                  expires_at: null,
                },
                {
                  source: "free_trial",
                  total: 500,
                  used: 0,
                  frozen: 0,
                  available: 500,
                  starts_at: null,
                  expires_at: null,
                },
              ],
            },
          },
          created_at: "2026-05-15T10:00:00.000Z",
        },
      },
    ]);
    const res = await client().customers.get("c1");
    expect(Object.keys(res.wallets)).toEqual(["default"]);
    expect(res.wallets["default"]!.available).toBe(900);
    expect(res.wallets["default"]!.sources).toHaveLength(2);
    expect(res.wallets["default"]!.sources[0]!.source).toBe("admin_grant");
    expect(res.createdAt).toBe("2026-05-15T10:00:00.000Z");
  });

  /**
   * Regression: dict-typed fields used to be over-converted. `wallets` keys
   * (wallet names like `email_counter`) and the inside of `metadata` (entirely
   * user-defined) are data, not API field names, and must not be touched by
   * the snake/camel converter.
   *
   * What MUST still get converted: the structured shape *inside* each wallet
   * balance — `WalletBalance.startsAt`, `sources[*].startsAt`, etc.
   */
  it("preserves underscore-bearing wallet keys but still camelCases nested WalletBalance fields", async () => {
    installMockFetch([
      {
        body: {
          id: "c1",
          name: null,
          email: null,
          metadata: null,
          wallets: {
            email_counter: {
              total: 100,
              used: 25,
              frozen: 0,
              available: 75,
              sources: [
                {
                  source: "free_trial",
                  total: 100,
                  used: 25,
                  frozen: 0,
                  available: 75,
                  starts_at: "2026-05-01T00:00:00.000Z",
                  expires_at: null,
                },
              ],
            },
          },
          created_at: "2026-05-15T10:00:00.000Z",
        },
      },
    ]);
    const res = await client().customers.get("c1");
    expect(Object.keys(res.wallets)).toEqual(["email_counter"]);
    const wallet = res.wallets["email_counter"]!;
    expect(wallet.available).toBe(75);
    // Grandchild (WalletSource) is structured and must be camelCased.
    expect(wallet.sources[0]!.startsAt).toBe("2026-05-01T00:00:00.000Z");
    expect(wallet.sources[0]!.expiresAt).toBeNull();
  });

  it("preserves the contents of metadata verbatim on response", async () => {
    installMockFetch([
      {
        body: {
          id: "c1",
          name: null,
          email: null,
          metadata: {
            user_tier: "pro",
            nested_thing: { with_keys: "stays put", deep: { keeps_going: true } },
          },
          wallets: {},
          created_at: "2026-05-15T10:00:00.000Z",
        },
      },
    ]);
    const res = await client().customers.get("c1");
    expect(res.metadata).toEqual({
      user_tier: "pro",
      nested_thing: { with_keys: "stays put", deep: { keeps_going: true } },
    });
  });

  it("preserves metadata contents verbatim on request body", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    await client().customers.deposit({
      customerId: "c1",
      amount: 100,
      metadata: { user_tier: "pro", custom_field: 1, nested: { keeps_keys: true } },
    });
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      amount: 100,
      metadata: {
        user_tier: "pro",
        custom_field: 1,
        nested: { keeps_keys: true },
      },
    });
  });
});

describe("customers.ledger", () => {
  it("GETs base path with no query when no params given", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().customers.ledger("c1");
    expect(calls[0]!.url).toBe(`${BASE}/v1/customers/c1/ledger`);
  });

  it("encodes filter params (operation_type, transaction_id) and pagination", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().customers.ledger("c1", {
      limit: 20,
      cursor: "abc",
      operationType: "CONSUME",
      transactionId: "txn_x",
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/customers/c1/ledger`);
    expect(queryOf(calls[0]!.url)).toEqual({
      limit: "20",
      cursor: "abc",
      operation_type: "CONSUME",
      transaction_id: "txn_x",
    });
  });

  it("parses ledger entries with wallet/source and pagination metadata", async () => {
    installMockFetch([
      {
        body: {
          items: [
            {
              id: "entry_1",
              operation_type: "FREEZE",
              amount: 100,
              wallet: "default",
              source: "admin_grant",
              transaction_id: "txn_a",
              business_type: "TASK",
              description: null,
              account_id: "acc_1",
              status: "ACTIVE",
              created_at: "2026-05-15T10:00:00.000Z",
            },
          ],
          total_count: 5,
          has_more: true,
          next_cursor: "cursor_2",
        },
      },
    ]);
    const res = await client().customers.ledger("c1", { limit: 1 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.wallet).toBe("default");
    expect(res.items[0]!.source).toBe("admin_grant");
    expect(res.totalCount).toBe(5);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe("cursor_2");
  });
});

function makeCustomer(id: string) {
  return {
    id,
    name: null,
    email: null,
    metadata: null,
    wallets: {},
    created_at: "2026-05-15T00:00:00.000Z",
  };
}
