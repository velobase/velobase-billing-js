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

function poolView(overrides: Record<string, unknown> = {}) {
  return {
    pool_id: "pool_1",
    wallet: "ip_quota",
    source: "default",
    capacity: 10,
    in_use: 0,
    available: 10,
    status: "ACTIVE",
    ...overrides,
  };
}

describe("slot.grantCapacity", () => {
  it("POSTs /v1/slot/grant with snake_case body", async () => {
    const { calls } = installMockFetch([{ body: poolView({ capacity: 15, in_use: 0, available: 15 }) }]);
    const res = await client().slot.grantCapacity({
      customerId: "c1",
      wallet: "ip_quota",
      source: "admin_grant",
      amount: 5,
      idempotencyKey: "grant-1",
      description: "monthly top-up",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/slot/grant`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      wallet: "ip_quota",
      source: "admin_grant",
      amount: 5,
      idempotency_key: "grant-1",
      description: "monthly top-up",
    });
    expect(res.poolId).toBe("pool_1");
    expect(res.capacity).toBe(15);
    expect(res.available).toBe(15);
    expect(res.status).toBe("ACTIVE");
  });
});

describe("slot.revokeCapacity", () => {
  it("POSTs /v1/slot/revoke and returns updated pool view", async () => {
    const { calls } = installMockFetch([
      { body: poolView({ capacity: 5, in_use: 0, available: 5 }) },
    ]);
    const res = await client().slot.revokeCapacity({
      customerId: "c1",
      wallet: "ip_quota",
      amount: 5,
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/slot/revoke`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      wallet: "ip_quota",
      amount: 5,
    });
    expect(res.capacity).toBe(5);
  });
});

describe("slot.claim", () => {
  it("POSTs /v1/slot/claim with resourceId; response includes holdingId", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          ...poolView({ in_use: 1, available: 9 }),
          holding_id: "hold_1",
        },
      },
    ]);
    const res = await client().slot.claim({
      customerId: "c1",
      wallet: "ip_quota",
      resourceId: "ip-1.2.3.4",
      amount: 1,
      description: "alloc for ip-1.2.3.4",
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/slot/claim`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      wallet: "ip_quota",
      resource_id: "ip-1.2.3.4",
      amount: 1,
      description: "alloc for ip-1.2.3.4",
    });
    expect(res.holdingId).toBe("hold_1");
    expect(res.inUse).toBe(1);
    expect(res.available).toBe(9);
  });

  it("defaults: omitted amount and description are simply absent from body", async () => {
    const { calls } = installMockFetch([
      { body: { ...poolView(), holding_id: "hold_2" } },
    ]);
    await client().slot.claim({
      customerId: "c1",
      wallet: "ip_quota",
      resourceId: "ip-9.9.9.9",
    });
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      wallet: "ip_quota",
      resource_id: "ip-9.9.9.9",
    });
  });
});

describe("slot.release", () => {
  it("POSTs /v1/slot/release", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          ...poolView({ in_use: 0, available: 10 }),
          holding_id: "hold_1",
        },
      },
    ]);
    const res = await client().slot.release({
      customerId: "c1",
      wallet: "ip_quota",
      resourceId: "ip-1.2.3.4",
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/slot/release`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      wallet: "ip_quota",
      resource_id: "ip-1.2.3.4",
    });
    expect(res.inUse).toBe(0);
    expect(res.available).toBe(10);
  });
});

describe("slot.getCustomer", () => {
  it("GETs /v1/slot/customer/<id> with no query when wallet omitted", async () => {
    const { calls } = installMockFetch([{ body: { pools: [] } }]);
    await client().slot.getCustomer("c1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/v1/slot/customer/c1`);
  });

  it("attaches ?wallet=<key> when wallet is provided", async () => {
    const { calls } = installMockFetch([{ body: { pools: [] } }]);
    await client().slot.getCustomer("c1", { wallet: "ip_quota" });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/slot/customer/c1`);
    expect(queryOf(calls[0]!.url)).toEqual({ wallet: "ip_quota" });
  });

  it("parses pool list with capacity/in_use/available", async () => {
    installMockFetch([
      {
        body: {
          pools: [
            poolView({ wallet: "ip_quota", capacity: 10, in_use: 3, available: 7 }),
            poolView({
              pool_id: "pool_2",
              wallet: "seat_quota",
              capacity: 5,
              in_use: 5,
              available: 0,
              status: "SUSPENDED",
            }),
          ],
        },
      },
    ]);
    const res = await client().slot.getCustomer("c1");
    expect(res.pools).toHaveLength(2);
    expect(res.pools[0]!.inUse).toBe(3);
    expect(res.pools[1]!.status).toBe("SUSPENDED");
  });
});

describe("slot.listEvents", () => {
  it("GETs base path with no query when no params given", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().slot.listEvents("c1");
    expect(calls[0]!.url).toBe(`${BASE}/v1/slot/events/c1`);
  });

  it("encodes wallet / resourceId / cursor / limit / types / sources / fromAt / toAt", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().slot.listEvents("c1", {
      wallet: "ip_quota",
      resourceId: "ip-1.2.3.4",
      cursor: "abc",
      limit: 50,
      types: ["GRANT_CAPACITY", "CLAIM"],
      sources: ["admin_grant", "free_trial"],
      fromAt: "2026-05-01T00:00:00.000Z",
      toAt: "2026-05-15T00:00:00.000Z",
    });
    expect(queryOf(calls[0]!.url)).toEqual({
      wallet: "ip_quota",
      resource_id: "ip-1.2.3.4",
      cursor: "abc",
      limit: "50",
      types: "GRANT_CAPACITY,CLAIM",
      sources: "admin_grant,free_trial",
      from_at: "2026-05-01T00:00:00.000Z",
      to_at: "2026-05-15T00:00:00.000Z",
    });
  });

  it("does not emit types/sources params when arrays are empty", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().slot.listEvents("c1", { types: [], sources: [] });
    expect(queryOf(calls[0]!.url)).toEqual({});
  });

  it("parses event entries with snake_case fields", async () => {
    installMockFetch([
      {
        body: {
          items: [
            {
              id: "ev_1",
              type: "CLAIM",
              wallet: "ip_quota",
              source: "admin_grant",
              amount: 1,
              resource_id: "ip-1.2.3.4",
              description: null,
              idempotency_key: null,
              created_at: "2026-05-15T10:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          next_cursor: null,
        },
      },
    ]);
    const res = await client().slot.listEvents("c1");
    expect(res.items[0]!.resourceId).toBe("ip-1.2.3.4");
    expect(res.items[0]!.idempotencyKey).toBeNull();
    expect(res.totalCount).toBe(1);
    expect(res.hasMore).toBe(false);
  });
});
