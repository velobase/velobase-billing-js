/**
 * Integration test for @velobase/billing TypeScript SDK.
 *
 * Prerequisites:
 *   1. API server running on localhost:3002
 *   2. A valid API key in the local database
 *
 * Usage:
 *   node test/integration.mjs                                    # uses defaults
 *   API_KEY=vb_live_xxx BASE_URL=http://localhost:3002 node test/integration.mjs
 *
 * Environment variables:
 *   API_KEY   — Velobase API key (required, or set below)
 *   BASE_URL  — API base URL (default: http://localhost:3002)
 */

import {
  Velobase,
  VelobaseError,
  VelobaseAuthenticationError,
  VelobaseValidationError,
  VelobaseNotFoundError,
} from "../dist/index.mjs";

const API_KEY = process.env.API_KEY || "vb_live_test_4ce5dc88e54a146bb290ad2460e48d52";
const BASE_URL = process.env.BASE_URL || "http://localhost:3002";

// ─── Test harness ────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) {
    failed++;
    failures.push(msg);
    console.log(`      ❌ FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// Unique prefix per run to avoid collision
const RUN = `ts_${Date.now().toString(36)}`;

// ─── Tests ───────────────────────────────────────────────────────

async function run() {
  // ===================== 1. AUTH =====================
  console.log("══════════════════════════════════");
  console.log(" 1. AUTH TESTS");
  console.log("══════════════════════════════════");

  console.log("\n  1.1 Empty API key → constructor throws");
  try {
    new Velobase({ apiKey: "" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(!(e instanceof VelobaseError), "plain Error, not VelobaseError");
    assert(e.message.includes("apiKey is required"), "correct message");
    console.log(`      OK: "${e.message}"`);
  }

  console.log("  1.2 Invalid API key → 401");
  try {
    const vb = new Velobase({ apiKey: "vb_live_fake", baseUrl: BASE_URL });
    await vb.customers.get("anyone");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof VelobaseAuthenticationError, "instanceof VelobaseAuthenticationError");
    assert(e.status === 401, "status=401");
    assert(e.type === "auth_error", "type=auth_error");
    console.log(`      OK: ${e.constructor.name} ${e.status} "${e.message}"`);
  }

  console.log("  1.3 Random string → 401");
  try {
    const vb = new Velobase({ apiKey: "garbage", baseUrl: BASE_URL });
    await vb.billing.freeze({ customerId: "x", amount: 1, transactionId: "b" });
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof VelobaseAuthenticationError, "instanceof VelobaseAuthenticationError");
    assert(e.status === 401, "status=401");
    console.log(`      OK: ${e.constructor.name} ${e.status}`);
  }

  const vb = new Velobase({ apiKey: API_KEY, baseUrl: BASE_URL });
  const CUSTOMER = `${RUN}_user`;

  // ===================== 2. CUSTOMERS =====================
  console.log("\n══════════════════════════════════");
  console.log(" 2. CUSTOMER TESTS");
  console.log("══════════════════════════════════");

  console.log("\n  2.1 Get non-existent customer → 404");
  try {
    await vb.customers.get("nonexistent_ghost_user");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e instanceof VelobaseNotFoundError, "instanceof VelobaseNotFoundError");
    assert(e.status === 404, "status=404");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  console.log("  2.2 Deposit 1000 (creates customer)");
  const dep1 = await vb.customers.deposit({
    customerId: CUSTOMER,
    amount: 1000,
    description: "Initial deposit",
  });
  assert(dep1.customerId === CUSTOMER, "customerId matches");
  assert(dep1.addedAmount === 1000, "addedAmount=1000");
  assert(dep1.totalAmount === 1000, "totalAmount=1000");
  assert(dep1.isIdempotentReplay === false, "not idempotent replay");
  assert(typeof dep1.accountId === "string" && dep1.accountId.length > 0, "has accountId");
  assert(typeof dep1.recordId === "string" && dep1.recordId.length > 0, "has recordId");
  console.log(`      OK: added=${dep1.addedAmount} total=${dep1.totalAmount}`);

  console.log("  2.3 Get customer → verify balance");
  const cust1 = await vb.customers.get(CUSTOMER);
  assert(cust1.id === CUSTOMER, "id matches");
  assert(cust1.balance.total === 1000, "total=1000");
  assert(cust1.balance.used === 0, "used=0");
  assert(cust1.balance.frozen === 0, "frozen=0");
  assert(cust1.balance.available === 1000, "available=1000");
  assert(cust1.accounts.length >= 1, "has accounts");
  assert(cust1.accounts[0].accountType === "CREDIT", "accountType=CREDIT");
  assert(cust1.accounts[0].creditType === "default", "creditType=default");
  assert(typeof cust1.createdAt === "string", "has createdAt");
  console.log(`      OK: balance=${JSON.stringify(cust1.balance)}`);

  console.log("  2.4 Idempotent deposit (same idempotencyKey)");
  const idemKey = `${RUN}_idem`;
  const dep2 = await vb.customers.deposit({
    customerId: CUSTOMER,
    amount: 500,
    idempotencyKey: idemKey,
  });
  assert(dep2.isIdempotentReplay === false, "first call: not replay");
  const dep3 = await vb.customers.deposit({
    customerId: CUSTOMER,
    amount: 500,
    idempotencyKey: idemKey,
  });
  assert(dep3.isIdempotentReplay === true, "second call: is replay");
  const cust1b = await vb.customers.get(CUSTOMER);
  assert(cust1b.balance.available === 1500, "available=1500 (not 2000)");
  console.log(`      OK: replay=${dep3.isIdempotentReplay} balance=${cust1b.balance.available}`);

  // ===================== 3. BILLING FLOW =====================
  console.log("\n══════════════════════════════════");
  console.log(" 3. BILLING FLOW");
  console.log("══════════════════════════════════");

  console.log("\n  3.1 Freeze 600");
  const txn1 = `${RUN}_txn1`;
  const frz1 = await vb.billing.freeze({
    customerId: CUSTOMER,
    amount: 600,
    transactionId: txn1,
    description: "Video generation job",
  });
  assert(frz1.transactionId === txn1, "transactionId matches");
  assert(frz1.frozenAmount === 600, "frozenAmount=600");
  assert(frz1.isIdempotentReplay === false, "not replay");
  assert(Array.isArray(frz1.freezeDetails) && frz1.freezeDetails.length > 0, "has freezeDetails");
  console.log(`      OK: frozen=${frz1.frozenAmount}`);

  console.log("  3.2 Balance after freeze");
  const cust2 = await vb.customers.get(CUSTOMER);
  assert(cust2.balance.frozen === 600, "frozen=600");
  assert(cust2.balance.available === 900, "available=900");
  console.log(`      OK: frozen=${cust2.balance.frozen} available=${cust2.balance.available}`);

  console.log("  3.3 Idempotent freeze (same transactionId)");
  const frz1b = await vb.billing.freeze({
    customerId: CUSTOMER,
    amount: 600,
    transactionId: txn1,
  });
  assert(frz1b.isIdempotentReplay === true, "is replay");
  console.log(`      OK: isIdempotentReplay=${frz1b.isIdempotentReplay}`);

  console.log("  3.4 Partial consume: 400 of 600 frozen");
  const con1 = await vb.billing.consume({
    transactionId: txn1,
    actualAmount: 400,
  });
  assert(con1.transactionId === txn1, "transactionId matches");
  assert(con1.consumedAmount === 400, "consumedAmount=400");
  assert(con1.returnedAmount === 200, "returnedAmount=200");
  assert(con1.isIdempotentReplay === false, "not replay");
  assert(typeof con1.consumedAt === "string", "has consumedAt");
  assert(Array.isArray(con1.consumeDetails), "has consumeDetails");
  console.log(`      OK: consumed=${con1.consumedAmount} returned=${con1.returnedAmount}`);

  console.log("  3.5 Balance after partial consume");
  const cust3 = await vb.customers.get(CUSTOMER);
  assert(cust3.balance.total === 1500, "total=1500");
  assert(cust3.balance.used === 400, "used=400");
  assert(cust3.balance.frozen === 0, "frozen=0");
  assert(cust3.balance.available === 1100, "available=1100");
  console.log(`      OK: ${JSON.stringify(cust3.balance)}`);

  console.log("  3.6 Freeze 300 → Unfreeze (full return)");
  const txn2 = `${RUN}_txn2`;
  await vb.billing.freeze({ customerId: CUSTOMER, amount: 300, transactionId: txn2 });
  const cust4 = await vb.customers.get(CUSTOMER);
  assert(cust4.balance.frozen === 300, "frozen=300 after freeze");
  assert(cust4.balance.available === 800, "available=800 after freeze");
  const unf1 = await vb.billing.unfreeze({ transactionId: txn2 });
  assert(unf1.transactionId === txn2, "transactionId matches");
  assert(unf1.unfrozenAmount === 300, "unfrozenAmount=300");
  assert(unf1.isIdempotentReplay === false, "not replay");
  assert(typeof unf1.unfrozenAt === "string", "has unfrozenAt");
  assert(Array.isArray(unf1.unfreezeDetails), "has unfreezeDetails");
  const cust5 = await vb.customers.get(CUSTOMER);
  assert(cust5.balance.frozen === 0, "frozen=0 after unfreeze");
  assert(cust5.balance.available === 1100, "available=1100 after unfreeze");
  console.log(`      OK: unfrozen=${unf1.unfrozenAmount} → balance=${JSON.stringify(cust5.balance)}`);

  console.log("  3.7 Full consume (no actualAmount specified)");
  const txn3 = `${RUN}_txn3`;
  await vb.billing.freeze({ customerId: CUSTOMER, amount: 200, transactionId: txn3 });
  const con2 = await vb.billing.consume({ transactionId: txn3 });
  assert(con2.consumedAmount === 200, "consumedAmount=200");
  assert(con2.returnedAmount === undefined || con2.returnedAmount === 0, "returnedAmount=undefined|0");
  const cust6 = await vb.customers.get(CUSTOMER);
  assert(cust6.balance.used === 600, "used=600");
  assert(cust6.balance.available === 900, "available=900");
  console.log(`      OK: consumed=${con2.consumedAmount} returned=${con2.returnedAmount} → avail=${cust6.balance.available}`);

  // ===================== 3B. DEDUCT FLOW =====================
  console.log("\n══════════════════════════════════");
  console.log(" 3B. DEDUCT FLOW");
  console.log("══════════════════════════════════");

  console.log("\n  3B.1 Direct deduct 50");
  const txnD1 = `${RUN}_deduct1`;
  const ded1 = await vb.billing.deduct({
    customerId: CUSTOMER,
    amount: 50,
    transactionId: txnD1,
    businessType: "TASK",
    description: "API call charge",
  });
  assert(ded1.transactionId === txnD1, "transactionId matches");
  assert(ded1.deductedAmount === 50, "deductedAmount=50");
  assert(ded1.isIdempotentReplay === false, "not replay");
  assert(typeof ded1.deductedAt === "string", "has deductedAt");
  assert(Array.isArray(ded1.deductDetails) && ded1.deductDetails.length > 0, "has deductDetails");
  console.log(`      OK: deducted=${ded1.deductedAmount}`);

  console.log("  3B.2 Balance after deduct");
  const cust7 = await vb.customers.get(CUSTOMER);
  assert(cust7.balance.used === 650, "used=650");
  assert(cust7.balance.available === 850, "available=850");
  console.log(`      OK: used=${cust7.balance.used} available=${cust7.balance.available}`);

  console.log("  3B.3 Idempotent deduct (same transactionId)");
  const ded1b = await vb.billing.deduct({
    customerId: CUSTOMER,
    amount: 50,
    transactionId: txnD1,
  });
  assert(ded1b.isIdempotentReplay === true, "is replay");
  const cust7b = await vb.customers.get(CUSTOMER);
  assert(cust7b.balance.available === 850, "available still 850");
  console.log(`      OK: replay=${ded1b.isIdempotentReplay} available=${cust7b.balance.available}`);

  console.log("  3B.4 Deduct insufficient balance");
  try {
    await vb.billing.deduct({ customerId: CUSTOMER, amount: 999999, transactionId: `${RUN}_deduct_fail` });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseValidationError, "instanceof VelobaseValidationError");
    assert(e.status === 400, "status=400");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  // ===================== 3C. LEDGER =====================
  console.log("\n══════════════════════════════════");
  console.log(" 3C. LEDGER");
  console.log("══════════════════════════════════");

  console.log("\n  3C.1 List all ledger entries");
  const ledger1 = await vb.customers.ledger(CUSTOMER);
  assert(Array.isArray(ledger1.items), "items is array");
  assert(ledger1.totalCount > 0, "totalCount > 0");
  assert(typeof ledger1.hasMore === "boolean", "hasMore is boolean");
  console.log(`      OK: totalCount=${ledger1.totalCount} items=${ledger1.items.length}`);

  console.log("  3C.2 Verify ledger entry fields");
  const entry = ledger1.items[0];
  assert(typeof entry.id === "string" && entry.id.length > 0, "has id");
  assert(["FREEZE", "CONSUME", "UNFREEZE", "GRANT", "EXPIRE"].includes(entry.operationType), "valid operationType");
  assert(typeof entry.amount === "number", "amount is number");
  assert(typeof entry.creditType === "string", "has creditType");
  assert(typeof entry.businessType === "string", "has businessType");
  assert(typeof entry.accountId === "string", "has accountId");
  assert(typeof entry.status === "string", "has status");
  assert(typeof entry.createdAt === "string", "has createdAt");
  console.log(`      OK: op=${entry.operationType} amount=${entry.amount} creditType=${entry.creditType}`);

  console.log("  3C.3 Filter by operationType=GRANT");
  const ledger2 = await vb.customers.ledger(CUSTOMER, { operationType: "GRANT" });
  assert(ledger2.items.length > 0, "has GRANT entries");
  assert(ledger2.items.every(e => e.operationType === "GRANT"), "all entries are GRANT");
  console.log(`      OK: GRANT entries=${ledger2.items.length}`);

  console.log("  3C.4 Filter by transactionId");
  const ledger3 = await vb.customers.ledger(CUSTOMER, { transactionId: txn1 });
  assert(ledger3.items.length > 0, "has entries for txn1");
  assert(ledger3.items.every(e => e.transactionId === txn1), "all entries match txn1");
  console.log(`      OK: entries for txn1=${ledger3.items.length}`);

  console.log("  3C.5 Pagination with limit");
  const ledger4 = await vb.customers.ledger(CUSTOMER, { limit: 2 });
  assert(ledger4.items.length <= 2, "items <= 2");
  if (ledger4.hasMore) {
    assert(ledger4.nextCursor !== null, "has nextCursor when hasMore");
    const ledger5 = await vb.customers.ledger(CUSTOMER, { limit: 2, cursor: ledger4.nextCursor });
    assert(ledger5.items.length > 0, "second page has items");
    assert(ledger5.items[0].id !== ledger4.items[0].id, "different items on page 2");
    console.log(`      OK: page1=${ledger4.items.length} page2=${ledger5.items.length}`);
  } else {
    console.log(`      OK: all items fit in one page (${ledger4.items.length})`);
  }

  console.log("  3C.6 Ledger for non-existent customer → 404");
  try {
    await vb.customers.ledger("nonexistent_ghost_user");
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseNotFoundError, "instanceof VelobaseNotFoundError");
    assert(e.status === 404, "status=404");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  // ===================== 4. ERROR HANDLING =====================
  console.log("\n══════════════════════════════════");
  console.log(" 4. ERROR HANDLING");
  console.log("══════════════════════════════════");

  console.log("\n  4.1 Insufficient balance");
  try {
    await vb.billing.freeze({ customerId: CUSTOMER, amount: 999999, transactionId: `${RUN}_fail1` });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseValidationError, "instanceof VelobaseValidationError");
    assert(e.status === 400, "status=400");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  console.log("  4.2 Consume non-existent transactionId");
  try {
    await vb.billing.consume({ transactionId: "nonexistent_txn_id" });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseError, "instanceof VelobaseError");
    assert(e.status >= 400, "status>=400");
    console.log(`      OK: ${e.constructor.name} ${e.status} "${e.message}"`);
  }

  console.log("  4.3 Deposit amount=0");
  try {
    await vb.customers.deposit({ customerId: CUSTOMER, amount: 0 });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseValidationError, "instanceof VelobaseValidationError");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  console.log("  4.4 Deposit amount=-1");
  try {
    await vb.customers.deposit({ customerId: CUSTOMER, amount: -1 });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseValidationError, "instanceof VelobaseValidationError");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  console.log("  4.5 Freeze with empty customerId");
  try {
    await vb.billing.freeze({ customerId: "", amount: 100, transactionId: "x" });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseValidationError, "instanceof VelobaseValidationError");
    console.log(`      OK: ${e.constructor.name} "${e.message}"`);
  }

  console.log("  4.6 Unfreeze non-existent transactionId");
  try {
    await vb.billing.unfreeze({ transactionId: "nonexistent_txn_id" });
    assert(false, "should throw");
  } catch (e) {
    assert(e instanceof VelobaseError, "instanceof VelobaseError");
    console.log(`      OK: ${e.constructor.name} ${e.status} "${e.message}"`);
  }

  // ===================== SUMMARY =====================
  console.log("\n══════════════════════════════════");
  console.log(" RESULTS");
  console.log("══════════════════════════════════");
  console.log(` Passed: ${passed}/${passed + failed}`);
  console.log(` Failed: ${failed}`);
  if (failures.length > 0) {
    console.log(" Failures:");
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  if (failed === 0) {
    console.log(" ✅ ALL TESTS PASSED");
  } else {
    console.log(" ❌ SOME TESTS FAILED");
    process.exit(1);
  }
}

run();
