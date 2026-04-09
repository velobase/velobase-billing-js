# @velobaseai/billing

Official Velobase Billing SDK for JavaScript and TypeScript.

- Zero runtime dependencies — uses native `fetch`
- Works with Node.js 18+, Deno, Bun, and Cloudflare Workers
- ESM and CommonJS dual build with full TypeScript declarations
- Automatic retries with exponential backoff

## Installation

```bash
npm install @velobaseai/billing
# or
pnpm add @velobaseai/billing
# or
yarn add @velobaseai/billing
```

## Quick Start

```typescript
import Velobase from '@velobaseai/billing';

const vb = new Velobase({ apiKey: 'vb_live_xxx' });

// 1. Deposit credits to a customer (creates the customer if new)
const deposit = await vb.customers.deposit({
  customerId: 'user_123',
  amount: 1000,
});

// 2. Check balance
const customer = await vb.customers.get('user_123');
console.log(customer.balance.available); // 1000

// 3. Generate transactionId once and persist before freezing
const transactionId = `user_123_${crypto.randomUUID()}`;

// 4. Freeze credits before doing work
const freeze = await vb.billing.freeze({
  customerId: 'user_123',
  amount: 50,
  transactionId,
});

// 5a. Job succeeded — consume (supports partial)
const consume = await vb.billing.consume({
  transactionId,
  actualAmount: 32, // only charge 32, return 18
});

// 5b. Or if the job failed — unfreeze to return all
const unfreeze = await vb.billing.unfreeze({ transactionId });
```

## How It Works

Velobase Billing uses a **freeze-then-consume** pattern to safely manage credits:

```
deposit → freeze → consume   (normal flow)
                 → unfreeze  (failure/cancellation)
```

It also supports a **direct deduct** pattern for immediate deduction without freezing:

```
deposit → deduct  (immediate deduction)
```

1. **Deposit** — Add credits to a customer's account. Creates the customer automatically on first deposit. Supports `creditType` to specify the credit category, and `startsAt`/`expiresAt` for time-limited credits.
2. **Freeze** — Pre-authorize an amount before performing work. The frozen credits are deducted from `available` but not yet `used`. Each freeze is identified by a unique `transactionId` you provide. Supports `creditTypes` to freeze from specific credit categories.
3. **Consume** — After the work is done, settle the frozen amount. You can pass `actualAmount` to charge less than what was frozen; the difference is automatically returned.
4. **Unfreeze** — If the work fails or is cancelled, release the full frozen amount back to the customer.
5. **Deduct** — Directly deduct credits from a customer without freezing first. Useful for immediate charges. Supports `creditTypes` to deduct from specific credit categories.

All write operations are **idempotent** — repeating the same `transactionId` (freeze/consume/unfreeze/deduct) or `idempotencyKey` (deposit) returns the original result without double-charging.

## Configuration

```typescript
const vb = new Velobase({
  apiKey: 'vb_live_xxx',             // Required. Your Velobase API key.
  baseUrl: 'https://api.velobase.io', // Optional. Override the API endpoint.
  timeout: 30000,                     // Optional. Request timeout in ms (default: 30s).
  maxRetries: 2,                      // Optional. Retry count on 5xx/network errors (default: 2).
});
```

## Usage Examples

### Deposit with idempotency

```typescript
// Safe to retry — the second call returns the same result without double-charging
const result = await vb.customers.deposit({
  customerId: 'user_123',
  amount: 500,
  idempotencyKey: 'order_abc_payment',
  description: 'Purchase of 500 credits',
});

console.log(result.addedAmount);        // 500
console.log(result.isIdempotentReplay); // false on first call, true on retries
```

### Deposit with credit type and expiry

```typescript
const result = await vb.customers.deposit({
  customerId: 'user_123',
  amount: 1000,
  creditType: 'BONUS',
  startsAt: '2025-01-01T00:00:00Z',
  expiresAt: '2025-12-31T23:59:59Z',
  description: 'Annual bonus credits',
});
console.log(result.creditType); // 'BONUS'
console.log(result.startsAt);  // '2025-01-01T00:00:00.000Z'
console.log(result.expiresAt); // '2025-12-31T23:59:59.000Z'
```

### Deposit with customer metadata

```typescript
const result = await vb.customers.deposit({
  customerId: 'user_123',
  amount: 1000,
  name: 'Alice',
  email: 'alice@example.com',
  metadata: { plan: 'pro', source: 'stripe' },
});
```

### Full billing flow (freeze-then-consume)

```typescript
const CUSTOMER = 'user_123';

// Generate transactionId once and persist before freezing
const transactionId = `${CUSTOMER}_${crypto.randomUUID().replace(/-/g, '')}`;

// Check balance before starting
const before = await vb.customers.get(CUSTOMER);
console.log('Available:', before.balance.available);

// Freeze the estimated cost
await vb.billing.freeze({
  customerId: CUSTOMER,
  amount: 100,
  transactionId,
  businessType: 'TASK',
  description: '1080p video, ~60s',
});

// ... do the work ...

// Settle with the actual cost (partial consumption)
const result = await vb.billing.consume({ transactionId, actualAmount: 73 });
console.log('Charged:', result.consumedAmount);  // 73
console.log('Returned:', result.returnedAmount); // 27

// Verify final balance
const after = await vb.customers.get(CUSTOMER);
console.log('Available:', after.balance.available);
```

### Direct deduct (without freezing)

```typescript
const CUSTOMER = 'user_123';
const transactionId = 'api_call_001';

const result = await vb.billing.deduct({
  customerId: CUSTOMER,
  amount: 5,
  transactionId,
  businessType: 'TASK',
  description: 'API call charge',
});
console.log('Deducted:', result.deductedAmount); // 5
console.log('At:', result.deductedAt);
```

### Freeze with creditTypes filter

```typescript
// Only freeze from specific credit categories
const freeze = await vb.billing.freeze({
  customerId: 'user_123',
  amount: 50,
  transactionId: 'job_abc',
  creditTypes: ['BONUS', 'DEFAULT'],
});
```

### Customer balance structure

```typescript
const customer = await vb.customers.get('user_123');

// Aggregate balance across all accounts
customer.balance.total;     // total deposited
customer.balance.used;      // total consumed
customer.balance.frozen;    // currently frozen (pending)
customer.balance.available; // total - used - frozen

// Individual accounts (e.g., different credit types/expiry)
for (const account of customer.accounts) {
  console.log(account.accountType); // 'CREDIT'
  console.log(account.creditType);  // 'DEFAULT', 'BONUS', etc.
  console.log(account.available);
  console.log(account.startsAt);    // null or ISO date string
  console.log(account.expiresAt);   // null or ISO date string
}
```

## API Reference

### `vb.customers.deposit(params): Promise<DepositResponse>`

Deposit credits. Creates the customer if they don't exist.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `customerId` | `string` | Yes | Your unique customer identifier |
| `amount` | `number` | Yes | Amount to deposit (must be > 0) |
| `creditType` | `string` | No | Credit category (e.g. "DEFAULT", "BONUS"). Defaults to "DEFAULT" on server. |
| `startsAt` | `string` | No | ISO datetime string. When the credits become active. |
| `expiresAt` | `string` | No | ISO datetime string. When the credits expire. Must be after `startsAt`. |
| `idempotencyKey` | `string` | No | Prevents duplicate deposits on retry |
| `name` | `string \| null` | No | Customer display name |
| `email` | `string \| null` | No | Customer email |
| `metadata` | `object` | No | Arbitrary key-value metadata |
| `description` | `string` | No | Description for the deposit |

**Returns:** `{ customerId, accountId, creditType, totalAmount, addedAmount, startsAt, expiresAt, recordId, isIdempotentReplay }`

### `vb.customers.get(customerId): Promise<CustomerResponse>`

Retrieve a customer's balance and account details.

**Returns:** `{ id, name, email, metadata, balance, accounts, createdAt }`

### `vb.billing.freeze(params): Promise<FreezeResponse>`

Freeze credits before performing work.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `customerId` | `string` | Yes | Customer identifier |
| `amount` | `number` | Yes | Amount to freeze (must be > 0) |
| `transactionId` | `string` | Yes | Your unique ID for this operation (idempotency key) |
| `creditTypes` | `string[]` | No | Restrict freeze to specific credit categories |
| `businessType` | `BusinessType` | No | Business category. See [businessType](#businesstype) for accepted values. |
| `description` | `string` | No | Human-readable description |

**Returns:** `{ transactionId, frozenAmount, freezeDetails, isIdempotentReplay }`

### `vb.billing.consume(params): Promise<ConsumeResponse>`

Settle a frozen amount. Supports partial consumption.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `transactionId` | `string` | Yes | The `transactionId` from the freeze |
| `actualAmount` | `number` | No | Actual amount to charge. Defaults to full frozen amount. |

**Returns:** `{ transactionId, consumedAmount, returnedAmount, consumeDetails, consumedAt, isIdempotentReplay }`

### `vb.billing.unfreeze(params): Promise<UnfreezeResponse>`

Release a frozen amount back to the customer.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `transactionId` | `string` | Yes | The `transactionId` from the freeze |

**Returns:** `{ transactionId, unfrozenAmount, unfreezeDetails, unfrozenAt, isIdempotentReplay }`

### `vb.billing.deduct(params): Promise<DeductResponse>`

Directly deduct credits without freezing first. Useful for immediate charges.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `customerId` | `string` | Yes | Customer identifier |
| `amount` | `number` | Yes | Amount to deduct (must be > 0) |
| `transactionId` | `string` | Yes | Your unique ID for this operation (idempotency key) |
| `creditTypes` | `string[]` | No | Restrict deduction to specific credit categories |
| `businessType` | `BusinessType` | No | Business category. See [businessType](#businesstype) for accepted values. |
| `description` | `string` | No | Human-readable description |

**Returns:** `{ transactionId, deductedAmount, deductDetails, deductedAt, isIdempotentReplay }`

## `transactionId`

`transactionId` uniquely identifies one billing operation (freeze → consume/unfreeze cycle, or a single deduct) and acts as its idempotency key. The server uses it to prevent double-charging on retries.

**Recommended format: `{customerId}_{uuid}`**

```typescript
// Generate once per billing operation, then persist it
const transactionId = `${customerId}_${crypto.randomUUID().replace(/-/g, '')}`;
// e.g. "user_123_a3f8c21d4e0b4a9f8c1d2e3f4a5b6c7d"
```

**Rules:**

- **Generate once and store** — create the ID before calling `freeze()` or `deduct()`, save it to your database, and reuse the same value on retries
- **Never regenerate at the call site** — calling `crypto.randomUUID()` inside `freeze()` produces a different ID on every attempt, breaking idempotency
- **Unique within your project** — two different billing operations must not share the same `transactionId`

```typescript
// Wrong — new UUID on every call, idempotency broken on retry
await vb.billing.freeze({
  customerId,
  amount: 50,
  transactionId: `${customerId}_${crypto.randomUUID()}`, // ❌ regenerated each time
});

// Correct — UUID generated once and persisted before calling freeze
const transactionId = await db.getOrCreateTransactionId(operationId, customerId);
// e.g. returns existing ID or stores `${customerId}_${crypto.randomUUID()}` on first call

await vb.billing.freeze({ customerId, amount: 50, transactionId });
// Safe to retry — same transactionId returns the original result
await vb.billing.freeze({ customerId, amount: 50, transactionId });
```

## businessType

`businessType` is an optional field on `freeze()` and `deduct()` that categorises the billing operation for analytics and reconciliation. The SDK validates the value client-side before sending the request.

**Accepted values:**

| Value | Description |
|---|---|
| `UNDEFINED` | Default / unclassified (server default when omitted) |
| `TASK` | Async task execution (e.g. video generation, image processing) |
| `ORDER` | One-time purchase or order fulfilment |
| `MEMBERSHIP` | Membership plan credit grant |
| `SUBSCRIPTION` | Subscription renewal credit grant |
| `FREE_TRIAL` | Free-trial credit grant |
| `ADMIN_GRANT` | Manually granted credits by an admin |

Passing an unrecognised value throws an `Error` immediately — before any network request is made.

```typescript
import Velobase, { type BusinessType } from '@velobaseai/billing';

const vb = new Velobase({ apiKey: 'vb_live_xxx' });

await vb.billing.freeze({
  customerId: 'user_123',
  amount: 50,
  transactionId: 'job_abc',
  businessType: 'TASK',        // ✅ IDE autocomplete + client-side validation
});

await vb.billing.freeze({
  customerId: 'user_123',
  amount: 50,
  transactionId: 'job_abc',
  businessType: 'INVALID_VAL', // ❌ throws Error before making a network call
});
```

## Error Handling

All API errors throw typed exceptions that extend `VelobaseError`:

```typescript
import {
  VelobaseError,
  VelobaseAuthenticationError,
  VelobaseValidationError,
  VelobaseNotFoundError,
} from '@velobaseai/billing';

try {
  await vb.billing.freeze({
    customerId: 'user_123',
    amount: 999999,
    transactionId: 'job_xyz',
  });
} catch (err) {
  if (err instanceof VelobaseValidationError) {
    // 400 — bad request or insufficient balance
    console.error(err.message); // "insufficient balance"
  } else if (err instanceof VelobaseAuthenticationError) {
    // 401 — invalid or missing API key
  } else if (err instanceof VelobaseNotFoundError) {
    // 404 — customer not found
  } else if (err instanceof VelobaseError) {
    // catch-all for other API errors
    console.error(err.status, err.type, err.message);
  }
}
```

| Error Class | HTTP Status | When |
|---|---|---|
| `VelobaseAuthenticationError` | 401 | Invalid or missing API key |
| `VelobaseValidationError` | 400 | Bad params, insufficient balance |
| `VelobaseNotFoundError` | 404 | Customer or resource not found |
| `VelobaseConflictError` | 409 | Conflicting operation |
| `VelobaseInternalError` | 500 | Server-side error (auto-retried) |

## Retries

The SDK automatically retries on 5xx errors and network failures with exponential backoff (500ms, 1s, 2s..., capped at 5s). Retries are safe because all Velobase write operations are idempotent.

4xx errors (validation, auth, not found) are never retried.

## CommonJS

```javascript
const { Velobase } = require('@velobaseai/billing');

const vb = new Velobase({ apiKey: 'vb_live_xxx' });
```

## License

MIT
