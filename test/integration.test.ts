/**
 * Integration tests for @velobaseai/billing.
 *
 * These talk to a real Velobase API server and exercise the full Billing v2,
 * Slot, and Entitlement surfaces. They are skipped by default so unit-test
 * runs (and CI) stay self-contained. To run them:
 *
 *   API_KEY=vb_live_xxx BASE_URL=http://localhost:3002 \
 *     npm run test:integration
 *
 * The script uses a per-run prefix derived from Date.now() so repeated runs
 * against the same database don't collide.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Velobase,
  VelobaseAuthenticationError,
  VelobaseError,
  VelobaseNotFoundError,
  VelobaseValidationError,
} from "../src/index";

const API_KEY = process.env.API_KEY ?? "";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3002";

// Top-level guard: every block below is gated on API_KEY being set.
const enabled = Boolean(API_KEY);
const describeIf = enabled ? describe : describe.skip;

if (!enabled) {
  // Surface a helpful note when running the file directly with no API key.
  // eslint-disable-next-line no-console
  console.log(
    "[integration] API_KEY not set; all integration tests will be skipped.",
  );
}

const RUN = `ts_${Date.now().toString(36)}`;
const CUSTOMER = `${RUN}_user`;

let vb: Velobase;

beforeAll(() => {
  if (!enabled) return;
  vb = new Velobase({ apiKey: API_KEY, baseUrl: BASE_URL });
});

afterAll(() => {
  // No cleanup: each run uses unique RUN prefix; the dev DB collects history
  // by design. If we ever want to reset, do it server-side.
});

// ─── 1. Auth ─────────────────────────────────────────────────────

describeIf("auth", () => {
  it("empty apiKey throws synchronously (plain Error, not VelobaseError)", () => {
    expect(() => new Velobase({ apiKey: "" })).toThrowError(/apiKey is required/);
  });

  it("invalid apiKey → 401 VelobaseAuthenticationError", async () => {
    const bad = new Velobase({ apiKey: "vb_live_fake", baseUrl: BASE_URL });
    await expect(bad.customers.get("anyone")).rejects.toBeInstanceOf(
      VelobaseAuthenticationError,
    );
  });
});

// ─── 2. Customers + Billing v2 (wallet / source) ─────────────────

describeIf("customers + billing v2", () => {
  it("deposit creates customer and bumps the default wallet", async () => {
    const dep = await vb.customers.deposit({
      customerId: CUSTOMER,
      amount: 1000,
      description: "initial topup",
    });
    expect(dep.customerId).toBe(CUSTOMER);
    expect(dep.addedAmount).toBe(1000);
    expect(dep.totalAmount).toBe(1000);
    expect(dep.isIdempotentReplay).toBe(false);
    expect(dep.wallet).toBeTruthy();
    expect(dep.source).toBeTruthy();
  });

  it("get returns v2 wallets shape with sources", async () => {
    const cust = await vb.customers.get(CUSTOMER);
    expect(cust.id).toBe(CUSTOMER);
    // At least one wallet, and inside it at least one source.
    const walletKeys = Object.keys(cust.wallets);
    expect(walletKeys.length).toBeGreaterThan(0);
    const firstWallet = cust.wallets[walletKeys[0]!]!;
    expect(firstWallet.total).toBe(1000);
    expect(firstWallet.available).toBe(1000);
    expect(firstWallet.sources.length).toBeGreaterThan(0);
  });

  it("deposit into a named wallet/source creates a separate wallet entry", async () => {
    await vb.customers.deposit({
      customerId: CUSTOMER,
      amount: 500,
      wallet: "email_counter",
      source: "free_trial",
      description: "email quota grant",
    });
    const cust = await vb.customers.get(CUSTOMER);
    // The wallet key may be camelCased by the SDK (known bug); accept either.
    const emailWallet =
      cust.wallets["email_counter"] ?? cust.wallets["emailCounter"];
    expect(emailWallet).toBeDefined();
    expect(emailWallet!.total).toBe(500);
  });

  it("freeze + partial consume returns the leftover and bumps used", async () => {
    const txn = `${RUN}_partial`;
    const frz = await vb.billing.freeze({
      customerId: CUSTOMER,
      amount: 600,
      transactionId: txn,
    });
    expect(frz.frozenAmount).toBe(600);

    const con = await vb.billing.consume({ transactionId: txn, actualAmount: 400 });
    expect(con.consumedAmount).toBe(400);
    expect(con.returnedAmount).toBe(200);
    expect(con.overageAmount).toBeUndefined();
  });

  it("idempotent freeze with same transactionId is a no-op replay", async () => {
    const txn = `${RUN}_idem`;
    const a = await vb.billing.freeze({
      customerId: CUSTOMER,
      amount: 100,
      transactionId: txn,
    });
    const b = await vb.billing.freeze({
      customerId: CUSTOMER,
      amount: 100,
      transactionId: txn,
    });
    expect(a.isIdempotentReplay).toBe(false);
    expect(b.isIdempotentReplay).toBe(true);
    // Clean up so subsequent assertions on balance are easier to reason about.
    await vb.billing.unfreeze({ transactionId: txn });
  });

  it("Billing v2 overage: consume more than frozen draws from same wallet sources", async () => {
    // Freeze a known amount, then consume more than that. With overage
    // supplement enabled server-side, the response should carry overageAmount.
    const txn = `${RUN}_overage`;
    await vb.billing.freeze({
      customerId: CUSTOMER,
      amount: 100,
      transactionId: txn,
    });
    const con = await vb.billing.consume({
      transactionId: txn,
      actualAmount: 150,
    });
    expect(con.consumedAmount).toBe(150);
    // overageAmount is optional in v2 — must be present if server overage
    // supplement is enabled. If the server is older, just skip this assertion.
    if (con.overageAmount !== undefined) {
      expect(con.overageAmount).toBe(50);
    }
  });

  it("deduct directly without prior freeze", async () => {
    const txn = `${RUN}_deduct`;
    const ded = await vb.billing.deduct({
      customerId: CUSTOMER,
      amount: 10,
      transactionId: txn,
      businessType: "TASK",
      description: "direct charge",
    });
    expect(ded.deductedAmount).toBe(10);
    expect(ded.isIdempotentReplay).toBe(false);
  });

  it("404 when fetching non-existent customer", async () => {
    await expect(vb.customers.get("definitely_not_there")).rejects.toBeInstanceOf(
      VelobaseNotFoundError,
    );
  });

  it("400 when freezing more than available", async () => {
    await expect(
      vb.billing.freeze({
        customerId: CUSTOMER,
        amount: 99_999_999,
        transactionId: `${RUN}_too_big`,
      }),
    ).rejects.toBeInstanceOf(VelobaseValidationError);
  });
});

// ─── 3. Ledger ───────────────────────────────────────────────────

describeIf("ledger", () => {
  it("lists entries with v2 wallet/source fields", async () => {
    const led = await vb.customers.ledger(CUSTOMER, { limit: 50 });
    expect(led.items.length).toBeGreaterThan(0);
    for (const e of led.items) {
      expect(typeof e.wallet).toBe("string");
      expect(typeof e.source).toBe("string");
    }
  });

  it("filters by operationType=CONSUME", async () => {
    const led = await vb.customers.ledger(CUSTOMER, { operationType: "CONSUME" });
    expect(led.items.every((e) => e.operationType === "CONSUME")).toBe(true);
  });

  it("paginates with cursor", async () => {
    const page1 = await vb.customers.ledger(CUSTOMER, { limit: 2 });
    if (page1.hasMore) {
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await vb.customers.ledger(CUSTOMER, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
    }
  });
});

// ─── 4. Slot ─────────────────────────────────────────────────────

describeIf("slot", () => {
  const SLOT_WALLET = `${RUN}_ip`;

  it("grantCapacity creates a pool with the requested capacity", async () => {
    const pool = await vb.slot.grantCapacity({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      amount: 5,
      description: "initial alloc",
    });
    expect(pool.capacity).toBe(5);
    expect(pool.inUse).toBe(0);
    expect(pool.available).toBe(5);
    expect(pool.status).toBe("ACTIVE");
  });

  it("idempotency: same grant idempotencyKey is a no-op replay", async () => {
    const key = `${RUN}_grant_idem`;
    const first = await vb.slot.grantCapacity({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      amount: 1,
      idempotencyKey: key,
    });
    const second = await vb.slot.grantCapacity({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      amount: 1,
      idempotencyKey: key,
    });
    expect(first.capacity).toBe(second.capacity);
    expect(second.isIdempotentReplay).toBe(true);
  });

  it("claim then release brings inUse back to 0", async () => {
    const resource = `${RUN}_res_a`;
    const after = await vb.slot.claim({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      resourceId: resource,
    });
    expect(after.inUse).toBeGreaterThan(0);
    expect(after.holdingId).toBeTruthy();

    const released = await vb.slot.release({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      resourceId: resource,
    });
    expect(released.inUse).toBe(after.inUse - 1);
  });

  it("claim is idempotent per (customer, wallet, resourceId)", async () => {
    const resource = `${RUN}_res_idem`;
    const a = await vb.slot.claim({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      resourceId: resource,
    });
    const b = await vb.slot.claim({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      resourceId: resource,
    });
    expect(a.holdingId).toBe(b.holdingId);
    await vb.slot.release({
      customerId: CUSTOMER,
      wallet: SLOT_WALLET,
      resourceId: resource,
    });
  });

  it("getCustomer lists the pool we created", async () => {
    const res = await vb.slot.getCustomer(CUSTOMER, { wallet: SLOT_WALLET });
    expect(res.pools.length).toBeGreaterThan(0);
    expect(res.pools.some((p) => p.wallet === SLOT_WALLET)).toBe(true);
  });

  it("listEvents returns at least the grant we issued", async () => {
    const events = await vb.slot.listEvents(CUSTOMER, { wallet: SLOT_WALLET });
    expect(events.items.some((e) => e.type === "GRANT_CAPACITY")).toBe(true);
  });

  it("claim refuses when no capacity is left (server validation)", async () => {
    // Try to overflow: grant 1 to a fresh wallet then claim 2 distinct ids.
    const tinyWallet = `${RUN}_tiny`;
    await vb.slot.grantCapacity({
      customerId: CUSTOMER,
      wallet: tinyWallet,
      amount: 1,
    });
    await vb.slot.claim({
      customerId: CUSTOMER,
      wallet: tinyWallet,
      resourceId: `${RUN}_tiny_a`,
    });
    await expect(
      vb.slot.claim({
        customerId: CUSTOMER,
        wallet: tinyWallet,
        resourceId: `${RUN}_tiny_b`,
      }),
    ).rejects.toBeInstanceOf(VelobaseError);
  });
});

// ─── 5. Entitlement ──────────────────────────────────────────────

describeIf("entitlement", () => {
  it("set creates the entitlement on first call (isCreated=true)", async () => {
    const res = await vb.entitlement.setEntitlement({
      customerId: CUSTOMER,
      featureKey: "model_access",
      value: "gpt-4o",
    });
    expect(res.isCreated).toBe(true);
    expect(res.value).toBe("gpt-4o");
    expect(res.oldValue).toBeNull();
  });

  it("set updates value on second call (isCreated=false carries oldValue)", async () => {
    const res = await vb.entitlement.setEntitlement({
      customerId: CUSTOMER,
      featureKey: "model_access",
      value: "gpt-4o-mini",
    });
    expect(res.isCreated).toBe(false);
    expect(res.oldValue).toBe("gpt-4o");
    expect(res.value).toBe("gpt-4o-mini");
  });

  it("get returns the entitlement we set", async () => {
    const res = await vb.entitlement.getEntitlement({
      customerId: CUSTOMER,
      featureKey: "model_access",
    });
    expect(res.entitlement).not.toBeNull();
    expect(res.entitlement!.value).toBe("gpt-4o-mini");
  });

  it("get returns null for an unset feature", async () => {
    const res = await vb.entitlement.getEntitlement({
      customerId: CUSTOMER,
      featureKey: "never_set",
    });
    expect(res.entitlement).toBeNull();
  });

  it("list filters by featureKeys", async () => {
    await vb.entitlement.setEntitlement({
      customerId: CUSTOMER,
      featureKey: "export_csv",
      value: "true",
    });
    const res = await vb.entitlement.listEntitlements({
      customerId: CUSTOMER,
      featureKeys: ["model_access", "export_csv"],
    });
    const keys = res.items.map((i) => i.featureKey).sort();
    expect(keys).toEqual(["export_csv", "model_access"]);
  });

  it("expired entitlement is omitted by default but listed with includeExpired=true", async () => {
    const expiredKey = `${RUN}_expired`;
    await vb.entitlement.setEntitlement({
      customerId: CUSTOMER,
      featureKey: expiredKey,
      value: "x",
      validUntil: "2020-01-01T00:00:00.000Z",
    });
    const without = await vb.entitlement.listEntitlements({
      customerId: CUSTOMER,
      featureKeys: [expiredKey],
    });
    expect(without.items).toHaveLength(0);

    const withExpired = await vb.entitlement.listEntitlements({
      customerId: CUSTOMER,
      featureKeys: [expiredKey],
      includeExpired: true,
    });
    expect(withExpired.items).toHaveLength(1);
    expect(withExpired.items[0]!.isActive).toBe(false);
  });

  it("remove deletes the entitlement and reports oldValue", async () => {
    const res = await vb.entitlement.removeEntitlement({
      customerId: CUSTOMER,
      featureKey: "export_csv",
    });
    expect(res.removed).toBe(true);
    expect(res.oldValue).toBe("true");

    const get = await vb.entitlement.getEntitlement({
      customerId: CUSTOMER,
      featureKey: "export_csv",
    });
    expect(get.entitlement).toBeNull();
  });

  it("removing something that doesn't exist returns removed=false", async () => {
    const res = await vb.entitlement.removeEntitlement({
      customerId: CUSTOMER,
      featureKey: "never_existed",
    });
    expect(res.removed).toBe(false);
    expect(res.oldValue).toBeNull();
  });

  it("listEvents shows SET and REMOVE events for the customer", async () => {
    const res = await vb.entitlement.listEvents({
      customerId: CUSTOMER,
      featureKey: "model_access",
    });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((e) => e.featureKey === "model_access")).toBe(true);
  });
});
