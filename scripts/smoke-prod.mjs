/**
 * Smoke test for @velobaseai/billing@1.0.0 against the live API.
 *
 *   API_KEY=vb_... node scripts/smoke-prod.mjs
 *
 * Optional: BASE_URL=https://api.velobase.io (default).
 *
 * Prints every step. Creates a single customer prefixed with `smoke_<rand>_`
 * and exercises billing v2 (wallet/source + overage), slot, entitlement, and
 * verifies the structured-error contract introduced in v1.0.0 — every
 * error response must hydrate `code`, `type`, `details`, and `requestId`.
 */
import { Velobase, VelobaseError } from "../dist/index.mjs";

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL ?? "https://api.velobase.io";
if (!API_KEY) {
  console.error("API_KEY env var is required");
  process.exit(1);
}

const RUN = `smoke_${Date.now().toString(36)}`;
const CUST = `${RUN}_user`;

const vb = new Velobase({ apiKey: API_KEY, baseUrl: BASE_URL });

function log(label, value) {
  console.log(`▸ ${label}`);
  if (value !== undefined) console.log("  ", JSON.stringify(value, null, 2).split("\n").join("\n   "));
}

async function main() {
  console.log(`baseUrl   = ${BASE_URL}`);
  console.log(`customer  = ${CUST}\n`);

  // 1. Deposit into default wallet
  log("1. deposit 1000 into default wallet");
  const d1 = await vb.customers.deposit({
    customerId: CUST,
    amount: 1000,
    description: "smoke initial",
  });
  log("   →", { wallet: d1.wallet, source: d1.source, total: d1.totalAmount });

  // 2. Deposit into a named wallet to prove the dict-key fix
  log("2. deposit 200 into wallet 'email_counter' / source 'free_trial'");
  const d2 = await vb.customers.deposit({
    customerId: CUST,
    amount: 200,
    wallet: "email_counter",
    source: "free_trial",
  });
  log("   →", { wallet: d2.wallet, source: d2.source, total: d2.totalAmount });

  // 3. Get customer — make sure both wallet keys survive verbatim
  log("3. get customer; wallets dict should keep underscored keys");
  const c1 = await vb.customers.get(CUST);
  log("   →", { walletKeys: Object.keys(c1.wallets) });

  // 4. Freeze + partial consume on default wallet
  const txn1 = `${RUN}_t1`;
  log(`4. freeze 600 / partial consume 400 (txn=${txn1})`);
  await vb.billing.freeze({ customerId: CUST, amount: 600, transactionId: txn1 });
  const con1 = await vb.billing.consume({ transactionId: txn1, actualAmount: 400 });
  log("   →", {
    consumed: con1.consumedAmount,
    returned: con1.returnedAmount,
    overage: con1.overageAmount,
  });

  // 5. Overage: freeze 50, consume 70 → expect overageAmount=20 (if server supports)
  const txn2 = `${RUN}_t2`;
  log(`5. freeze 50 / consume 70 → expect overage (txn=${txn2})`);
  try {
    await vb.billing.freeze({ customerId: CUST, amount: 50, transactionId: txn2 });
    const con2 = await vb.billing.consume({ transactionId: txn2, actualAmount: 70 });
    log("   →", {
      consumed: con2.consumedAmount,
      overage: con2.overageAmount,
    });
  } catch (e) {
    log("   ! overage path errored", { name: e.constructor.name, status: e.status, message: e.message });
  }

  // 6. Slot
  const slotWallet = `${RUN}_ip`;
  log(`6. slot.grantCapacity(${slotWallet}, 3)`);
  const p1 = await vb.slot.grantCapacity({ customerId: CUST, wallet: slotWallet, amount: 3 });
  log("   →", { capacity: p1.capacity, inUse: p1.inUse, available: p1.available });

  log("   slot.claim ip-1.2.3.4");
  const cl1 = await vb.slot.claim({ customerId: CUST, wallet: slotWallet, resourceId: "ip-1.2.3.4" });
  log("   →", { holdingId: cl1.holdingId, inUse: cl1.inUse, available: cl1.available });

  log("   slot.release ip-1.2.3.4");
  const rl1 = await vb.slot.release({ customerId: CUST, wallet: slotWallet, resourceId: "ip-1.2.3.4" });
  log("   →", { inUse: rl1.inUse, available: rl1.available });

  log("   slot.getCustomer");
  const sg = await vb.slot.getCustomer(CUST);
  log("   →", { pools: sg.pools.map((p) => ({ wallet: p.wallet, capacity: p.capacity, inUse: p.inUse })) });

  // 7. Entitlement
  log("7. entitlement.setEntitlement(model_access = gpt-4o)");
  const e1 = await vb.entitlement.setEntitlement({
    customerId: CUST,
    featureKey: "model_access",
    value: "gpt-4o",
  });
  log("   →", { isCreated: e1.isCreated, value: e1.value, oldValue: e1.oldValue });

  log("   entitlement.setEntitlement(model_access = gpt-4o-mini) — update");
  const e2 = await vb.entitlement.setEntitlement({
    customerId: CUST,
    featureKey: "model_access",
    value: "gpt-4o-mini",
  });
  log("   →", { isCreated: e2.isCreated, value: e2.value, oldValue: e2.oldValue });

  log("   entitlement.getEntitlement(model_access)");
  const e3 = await vb.entitlement.getEntitlement({
    customerId: CUST,
    featureKey: "model_access",
  });
  log("   →", e3.entitlement && { value: e3.entitlement.value });

  log("   entitlement.listEntitlements");
  const el = await vb.entitlement.listEntitlements({ customerId: CUST });
  log("   →", { items: el.items.map((i) => ({ featureKey: i.featureKey, value: i.value, isActive: i.isActive })) });

  log("   entitlement.removeEntitlement(model_access)");
  const er = await vb.entitlement.removeEntitlement({
    customerId: CUST,
    featureKey: "model_access",
  });
  log("   →", { removed: er.removed, oldValue: er.oldValue });

  // ─── 8. Error contract ──────────────────────────────────────────
  //
  // Every assertion below pins a server-side error code, type, and
  // requires the SDK to hydrate it onto `VelobaseError` along with
  // `requestId` for log correlation.
  console.log("\n— error contract —");

  await assertError({
    label: "8a. customer_not_found",
    expectedCode: "customer_not_found",
    expectedType: "not_found",
    expectedStatus: 404,
    run: () => vb.customers.get(`${RUN}_no_such_customer`),
  });

  await assertError({
    label: "8b. insufficient_balance + details payload",
    expectedCode: "insufficient_balance",
    expectedType: "bad_request",
    expectedStatus: 400,
    expectedDetailsKeys: ["wallet", "requested", "available"],
    run: () =>
      vb.billing.freeze({
        customerId: CUST,
        amount: 999_999_999,
        transactionId: `${RUN}_too_big`,
      }),
  });

  await assertError({
    label: "8c. amount_must_be_positive (boundary validation)",
    expectedCode: "amount_must_be_positive",
    expectedType: "bad_request",
    expectedStatus: 400,
    run: () =>
      vb.billing.freeze({
        customerId: CUST,
        amount: 0,
        transactionId: `${RUN}_zero`,
      }),
  });

  await assertError({
    label: "8d. invalid_api_key",
    expectedCode: "invalid_api_key",
    expectedType: "auth_error",
    expectedStatus: 401,
    run: () =>
      new Velobase({ apiKey: "vb_smoke_invalid", baseUrl: BASE_URL })
        .customers.get(CUST),
  });

  await assertError({
    label: "8e. slot_pool_not_found",
    expectedCode: "slot_pool_not_found",
    expectedType: "not_found",
    expectedStatus: 404,
    run: () =>
      vb.slot.claim({
        customerId: CUST,
        wallet: `${RUN}_no_pool`,
        resourceId: "ip-9.9.9.9",
      }),
  });

  console.log("\n✅ smoke complete");
}

async function assertError({
  label,
  run,
  expectedCode,
  expectedType,
  expectedStatus,
  expectedDetailsKeys = [],
}) {
  log(label);
  try {
    await run();
    fail(label, "expected the call to throw, but it succeeded");
  } catch (err) {
    if (!(err instanceof VelobaseError)) {
      fail(label, `expected VelobaseError, got ${err?.constructor?.name}`);
    }
    if (err.code !== expectedCode) {
      fail(label, `code mismatch: expected=${expectedCode} got=${err.code}`);
    }
    if (err.type !== expectedType) {
      fail(label, `type mismatch: expected=${expectedType} got=${err.type}`);
    }
    if (err.status !== expectedStatus) {
      fail(
        label,
        `status mismatch: expected=${expectedStatus} got=${err.status}`,
      );
    }
    for (const key of expectedDetailsKeys) {
      if (!(key in err.details)) {
        fail(label, `details.${key} missing; got keys=${Object.keys(err.details).join(",")}`);
      }
    }
    if (!err.requestId) {
      fail(label, "requestId missing — server must always emit X-Request-Id");
    }
    log("   ✓", {
      code: err.code,
      type: err.type,
      status: err.status,
      requestId: err.requestId,
      detailsKeys: Object.keys(err.details),
    });
  }
}

function fail(label, reason) {
  console.error(`\n❌ ${label}: ${reason}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("\n❌ smoke failed:", e?.constructor?.name, e?.status, e?.message);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
