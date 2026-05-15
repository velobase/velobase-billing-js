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

function entitlementView(overrides: Record<string, unknown> = {}) {
  return {
    entitlement_id: "ent_1",
    feature_key: "model_access",
    value: "gpt-4o",
    valid_from: null,
    valid_until: null,
    source: "default",
    description: null,
    metadata: null,
    ...overrides,
  };
}

describe("entitlement.setEntitlement", () => {
  it("POSTs /v1/entitlement/set with snake_case body and parses isCreated", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          ...entitlementView({ value: "gpt-4o", source: "pro_plan" }),
          is_created: true,
          old_value: null,
        },
      },
    ]);
    const res = await client().entitlement.setEntitlement({
      customerId: "c1",
      featureKey: "model_access",
      value: "gpt-4o",
      validUntil: "2026-12-31T23:59:59.000Z",
      source: "pro_plan",
      description: "pro plan grant",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/entitlement/set`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      feature_key: "model_access",
      value: "gpt-4o",
      valid_until: "2026-12-31T23:59:59.000Z",
      source: "pro_plan",
      description: "pro plan grant",
    });
    expect(res.entitlementId).toBe("ent_1");
    expect(res.value).toBe("gpt-4o");
    expect(res.isCreated).toBe(true);
    expect(res.oldValue).toBeNull();
  });

  it("update path: isCreated=false carries oldValue", async () => {
    installMockFetch([
      {
        body: {
          ...entitlementView({ value: "gpt-4o-mini" }),
          is_created: false,
          old_value: "gpt-3.5",
        },
      },
    ]);
    const res = await client().entitlement.setEntitlement({
      customerId: "c1",
      featureKey: "model_access",
      value: "gpt-4o-mini",
    });
    expect(res.isCreated).toBe(false);
    expect(res.oldValue).toBe("gpt-3.5");
  });
});

describe("entitlement.getEntitlement", () => {
  it("GETs /v1/entitlement/<customer>/<feature>", async () => {
    const { calls } = installMockFetch([
      { body: { entitlement: entitlementView({ value: "true" }) } },
    ]);
    const res = await client().entitlement.getEntitlement({
      customerId: "c1",
      featureKey: "export_csv",
    });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/v1/entitlement/c1/export_csv`);
    expect(res.entitlement).not.toBeNull();
    expect(res.entitlement!.value).toBe("true");
  });

  it("returns entitlement=null when server reports null", async () => {
    installMockFetch([{ body: { entitlement: null } }]);
    const res = await client().entitlement.getEntitlement({
      customerId: "c1",
      featureKey: "missing_feature",
    });
    expect(res.entitlement).toBeNull();
  });

  it("URL-encodes featureKey and customerId", async () => {
    const { calls } = installMockFetch([{ body: { entitlement: null } }]);
    await client().entitlement.getEntitlement({
      customerId: "user+1@example.com",
      featureKey: "feature/with slash",
    });
    expect(calls[0]!.url).toBe(
      `${BASE}/v1/entitlement/${encodeURIComponent("user+1@example.com")}/${encodeURIComponent("feature/with slash")}`,
    );
  });
});

describe("entitlement.listEntitlements", () => {
  it("GETs /v1/entitlement/<customer> with no query when no filter", async () => {
    const { calls } = installMockFetch([{ body: { items: [] } }]);
    await client().entitlement.listEntitlements({ customerId: "c1" });
    expect(calls[0]!.url).toBe(`${BASE}/v1/entitlement/c1`);
  });

  it("encodes feature_keys CSV and include_expired flag", async () => {
    const { calls } = installMockFetch([{ body: { items: [] } }]);
    await client().entitlement.listEntitlements({
      customerId: "c1",
      featureKeys: ["model_access", "export_csv"],
      includeExpired: true,
    });
    expect(queryOf(calls[0]!.url)).toEqual({
      feature_keys: "model_access,export_csv",
      include_expired: "true",
    });
  });

  it("omits feature_keys when array is empty", async () => {
    const { calls } = installMockFetch([{ body: { items: [] } }]);
    await client().entitlement.listEntitlements({
      customerId: "c1",
      featureKeys: [],
    });
    expect(queryOf(calls[0]!.url)).toEqual({});
  });

  it("parses items with isActive flag", async () => {
    installMockFetch([
      {
        body: {
          items: [
            { ...entitlementView({ feature_key: "model_access", value: "gpt-4o" }), is_active: true },
            { ...entitlementView({ feature_key: "export_csv", value: "true" }), is_active: false },
          ],
        },
      },
    ]);
    const res = await client().entitlement.listEntitlements({ customerId: "c1" });
    expect(res.items).toHaveLength(2);
    expect(res.items[0]!.isActive).toBe(true);
    expect(res.items[0]!.featureKey).toBe("model_access");
    expect(res.items[1]!.isActive).toBe(false);
  });
});

describe("entitlement.removeEntitlement", () => {
  it("POSTs /v1/entitlement/remove", async () => {
    const { calls } = installMockFetch([
      { body: { removed: true, old_value: "gpt-4o" } },
    ]);
    const res = await client().entitlement.removeEntitlement({
      customerId: "c1",
      featureKey: "model_access",
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/entitlement/remove`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      feature_key: "model_access",
    });
    expect(res.removed).toBe(true);
    expect(res.oldValue).toBe("gpt-4o");
  });

  it("removed=false when nothing existed", async () => {
    installMockFetch([{ body: { removed: false, old_value: null } }]);
    const res = await client().entitlement.removeEntitlement({
      customerId: "c1",
      featureKey: "never_set",
    });
    expect(res.removed).toBe(false);
    expect(res.oldValue).toBeNull();
  });
});

describe("entitlement.listEvents", () => {
  it("GETs /v1/entitlement/<customer>/events", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().entitlement.listEvents({ customerId: "c1" });
    expect(calls[0]!.url).toBe(`${BASE}/v1/entitlement/c1/events`);
  });

  it("encodes feature_key / cursor / limit / types / fromAt / toAt", async () => {
    const { calls } = installMockFetch([
      { body: { items: [], total_count: 0, has_more: false, next_cursor: null } },
    ]);
    await client().entitlement.listEvents({
      customerId: "c1",
      featureKey: "model_access",
      cursor: "abc",
      limit: 50,
      types: ["SET", "REMOVE"],
      fromAt: "2026-05-01T00:00:00.000Z",
      toAt: "2026-05-15T00:00:00.000Z",
    });
    expect(queryOf(calls[0]!.url)).toEqual({
      feature_key: "model_access",
      cursor: "abc",
      limit: "50",
      types: "SET,REMOVE",
      from_at: "2026-05-01T00:00:00.000Z",
      to_at: "2026-05-15T00:00:00.000Z",
    });
  });

  it("parses event entries with old/new value transitions", async () => {
    installMockFetch([
      {
        body: {
          items: [
            {
              id: "ev_1",
              feature_key: "model_access",
              type: "SET",
              old_value: "gpt-3.5",
              new_value: "gpt-4o",
              source: "pro_plan",
              description: "upgrade",
              created_at: "2026-05-15T10:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          next_cursor: null,
        },
      },
    ]);
    const res = await client().entitlement.listEvents({ customerId: "c1" });
    expect(res.items[0]!.oldValue).toBe("gpt-3.5");
    expect(res.items[0]!.newValue).toBe("gpt-4o");
    expect(res.totalCount).toBe(1);
  });
});
