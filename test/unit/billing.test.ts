import { describe, expect, it } from "vitest";
import { Velobase } from "../../src/client";
import { assertBusinessType } from "../../src/types";
import { installMockFetch, pathOf } from "./helpers";

const BASE = "https://api.example.com";

function client() {
  return new Velobase({
    apiKey: "vb_test",
    baseUrl: BASE,
    timeout: 5_000,
    maxRetries: 0,
  });
}

describe("assertBusinessType", () => {
  it("accepts known values", () => {
    for (const v of [
      "UNDEFINED",
      "TASK",
      "ORDER",
      "MEMBERSHIP",
      "SUBSCRIPTION",
      "FREE_TRIAL",
      "ADMIN_GRANT",
      "TOKEN_USAGE",
    ]) {
      expect(() => assertBusinessType(v)).not.toThrow();
    }
  });

  it("rejects unknown values with a helpful message", () => {
    expect(() => assertBusinessType("garbage")).toThrowError(
      /Invalid businessType: "garbage"/,
    );
    expect(() => assertBusinessType("task")).toThrow(); // lower case: rejected
  });
});

describe("billing.freeze", () => {
  it("POSTs /v1/billing/freeze with snake_case body", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          frozen_amount: 600,
          freeze_details: [{ source: "admin_grant", amount: 600 }],
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.freeze({
      customerId: "c1",
      amount: 600,
      transactionId: "txn_1",
      wallet: "default",
      businessType: "TASK",
      description: "video generation",
    });

    expect(calls[0]!.method).toBe("POST");
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/billing/freeze`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      amount: 600,
      transaction_id: "txn_1",
      wallet: "default",
      business_type: "TASK",
      description: "video generation",
    });
    expect(res.frozenAmount).toBe(600);
    expect(res.isIdempotentReplay).toBe(false);
  });

  it("rejects invalid businessType client-side before issuing a request", async () => {
    const { calls } = installMockFetch([{ body: {} }]); // should never be hit
    await expect(
      client().billing.freeze({
        customerId: "c1",
        amount: 1,
        transactionId: "txn",
        businessType: "NOT_A_REAL_TYPE",
      }),
    ).rejects.toThrowError(/Invalid businessType/);
    expect(calls).toHaveLength(0);
  });

  it("returns isIdempotentReplay=true when server reports replay", async () => {
    installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          frozen_amount: 600,
          freeze_details: [],
          is_idempotent_replay: true,
        },
      },
    ]);
    const res = await client().billing.freeze({
      customerId: "c1",
      amount: 600,
      transactionId: "txn_1",
    });
    expect(res.isIdempotentReplay).toBe(true);
  });
});

describe("billing.consume", () => {
  it("POSTs /v1/billing/consume; partial consume returns returnedAmount", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          consumed_amount: 400,
          returned_amount: 200,
          consume_details: [],
          consumed_at: "2026-05-15T10:00:00.000Z",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.consume({
      transactionId: "txn_1",
      actualAmount: 400,
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/billing/consume`);
    expect(calls[0]!.body).toEqual({
      transaction_id: "txn_1",
      actual_amount: 400,
    });
    expect(res.consumedAmount).toBe(400);
    expect(res.returnedAmount).toBe(200);
    expect(res.overageAmount).toBeUndefined();
  });

  it("full consume with no actualAmount specified", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          consumed_amount: 600,
          consume_details: [],
          consumed_at: "2026-05-15T10:00:00.000Z",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.consume({ transactionId: "txn_1" });
    expect(calls[0]!.body).toEqual({ transaction_id: "txn_1" });
    expect(res.consumedAmount).toBe(600);
    expect(res.returnedAmount).toBeUndefined();
  });

  it("Billing v2: overage supplement surfaces overageAmount in the response", async () => {
    installMockFetch([
      {
        body: {
          transaction_id: "txn_1",
          consumed_amount: 850,
          overage_amount: 250,
          consume_details: [
            { source: "admin_grant", consumed: 600 },
            { source: "free_trial", consumed: 250 },
          ],
          consumed_at: "2026-05-15T10:00:00.000Z",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.consume({
      transactionId: "txn_1",
      actualAmount: 850,
    });
    expect(res.consumedAmount).toBe(850);
    expect(res.overageAmount).toBe(250);
    expect(res.returnedAmount).toBeUndefined();
    expect(res.consumeDetails).toHaveLength(2);
  });
});

describe("billing.unfreeze", () => {
  it("POSTs /v1/billing/unfreeze and returns unfrozenAmount", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          transaction_id: "txn_2",
          unfrozen_amount: 300,
          unfreeze_details: [{ source: "admin_grant", amount: 300 }],
          unfrozen_at: "2026-05-15T11:00:00.000Z",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.unfreeze({ transactionId: "txn_2" });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/billing/unfreeze`);
    expect(calls[0]!.body).toEqual({ transaction_id: "txn_2" });
    expect(res.unfrozenAmount).toBe(300);
    expect(res.isIdempotentReplay).toBe(false);
  });
});

describe("billing.deduct", () => {
  it("POSTs /v1/billing/deduct with all fields", async () => {
    const { calls } = installMockFetch([
      {
        body: {
          transaction_id: "ded_1",
          deducted_amount: 50,
          deduct_details: [{ source: "admin_grant", amount: 50 }],
          deducted_at: "2026-05-15T10:00:00.000Z",
          is_idempotent_replay: false,
        },
      },
    ]);
    const res = await client().billing.deduct({
      customerId: "c1",
      amount: 50,
      transactionId: "ded_1",
      wallet: "default",
      businessType: "TASK",
      description: "api call",
    });
    expect(pathOf(calls[0]!.url)).toBe(`${BASE}/v1/billing/deduct`);
    expect(calls[0]!.body).toEqual({
      customer_id: "c1",
      amount: 50,
      transaction_id: "ded_1",
      wallet: "default",
      business_type: "TASK",
      description: "api call",
    });
    expect(res.deductedAmount).toBe(50);
  });

  it("rejects invalid businessType client-side", async () => {
    const { calls } = installMockFetch([{ body: {} }]);
    await expect(
      client().billing.deduct({
        customerId: "c1",
        amount: 50,
        transactionId: "ded_1",
        businessType: "BOGUS",
      }),
    ).rejects.toThrowError(/Invalid businessType/);
    expect(calls).toHaveLength(0);
  });
});
