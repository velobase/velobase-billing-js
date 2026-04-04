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

// 3. Generate businessId once and persist before freezing
const businessId = `user_123_${crypto.randomUUID()}`;

// 4. Freeze credits before doing work
const freeze = await vb.billing.freeze({
  customerId: 'user_123',
  amount: 50,
  businessId,
});

// 5a. Job succeeded — consume (supports partial)
const consume = await vb.billing.consume({
  businessId,
  actualAmount: 32, // only charge 32, return 18
});

// 5b. Or if the job failed — unfreeze to return all
const unfreeze = await vb.billing.unfreeze({ businessId });
```

## How It Works

Velobase Billing uses a **freeze-then-consume** pattern to safely manage credits:

```
deposit → freeze → consume   (normal flow)
                 → unfreeze  (failure/cancellation)
```

1. **Deposit** — Add credits to a customer's account. Creates the customer automatically on first deposit.
2. **Freeze** — Pre-authorize an amount before performing work. The frozen credits are deducted from `available` but not yet `used`. Each freeze is identified by a unique `businessId` you provide.
3. **Consume** — After the work is done, settle the frozen amount. You can pass `actualAmount` to charge less than what was frozen; the difference is automatically returned.
4. **Unfreeze** — If the work fails or is cancelled, release the full frozen amount back to the customer.

All write operations are **idempotent** — repeating the same `businessId` (freeze/consume/unfreeze) or `idempotencyKey` (deposit) returns the original result without double-charging.

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

### Full billing flow

```typescript
const CUSTOMER = 'user_123';

// Generate businessId once and persist before freezing
const businessId = `${CUSTOMER}_${crypto.randomUUID().replace(/-/g, '')}`;

// Check balance before starting
const before = await vb.customers.get(CUSTOMER);
console.log('Available:', before.balance.available);

// Freeze the estimated cost
await vb.billing.freeze({
  customerId: CUSTOMER,
  amount: 100,
  businessId,
  businessType: 'video_generation',
  description: '1080p video, ~60s',
});

// ... do the work ...

// Settle with the actual cost (partial consumption)
const result = await vb.billing.consume({ businessId, actualAmount: 73 });
console.log('Charged:', result.consumedAmount);  // 73
console.log('Returned:', result.returnedAmount); // 27

// Verify final balance
const after = await vb.customers.get(CUSTOMER);
console.log('Available:', after.balance.available);
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
  console.log(account.accountType);    // 'CREDIT'
  console.log(account.subAccountType); // 'DEFAULT'
  console.log(account.available);
  console.log(account.expiresAt);      // null or ISO date string
}
```

## API Reference

### `vb.customers.deposit(params): Promise<DepositResponse>`

Deposit credits. Creates the customer if they don't exist.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `customerId` | `string` | Yes | Your unique customer identifier |
| `amount` | `number` | Yes | Amount to deposit (must be > 0) |
| `idempotencyKey` | `string` | No | Prevents duplicate deposits on retry |
| `name` | `string \| null` | No | Customer display name |
| `email` | `string \| null` | No | Customer email |
| `metadata` | `object` | No | Arbitrary key-value metadata |
| `description` | `string` | No | Description for the deposit |

**Returns:** `{ customerId, accountId, totalAmount, addedAmount, recordId, isIdempotentReplay }`

### `vb.customers.get(customerId): Promise<CustomerResponse>`

Retrieve a customer's balance and account details.

**Returns:** `{ id, name, email, metadata, balance, accounts, createdAt }`

### `vb.billing.freeze(params): Promise<FreezeResponse>`

Freeze credits before performing work.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `customerId` | `string` | Yes | Customer identifier |
| `amount` | `number` | Yes | Amount to freeze (must be > 0) |
| `businessId` | `string` | Yes | Your unique ID for this operation (idempotency key) |
| `businessType` | `string` | No | Category label (e.g., `'video_generation'`) |
| `description` | `string` | No | Human-readable description |

**Returns:** `{ businessId, frozenAmount, freezeDetails, isIdempotentReplay }`

### `vb.billing.consume(params): Promise<ConsumeResponse>`

Settle a frozen amount. Supports partial consumption.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `businessId` | `string` | Yes | The `businessId` from the freeze |
| `actualAmount` | `number` | No | Actual amount to charge. Defaults to full frozen amount. |

**Returns:** `{ businessId, consumedAmount, returnedAmount, consumeDetails, consumedAt, isIdempotentReplay }`

### `vb.billing.unfreeze(params): Promise<UnfreezeResponse>`

Release a frozen amount back to the customer.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `businessId` | `string` | Yes | The `businessId` from the freeze |

**Returns:** `{ businessId, unfrozenAmount, unfreezeDetails, unfrozenAt, isIdempotentReplay }`

## `businessId`

`businessId` uniquely identifies one freeze → consume/unfreeze cycle and acts as its idempotency key. The server uses it to prevent double-charging on retries.

**Recommended format: `{customerId}_{uuid}`**

```typescript
// Generate once per billing operation, then persist it
const businessId = `${customerId}_${crypto.randomUUID().replace(/-/g, '')}`;
// e.g. "user_123_a3f8c21d4e0b4a9f8c1d2e3f4a5b6c7d"
```

**Rules:**

- **Generate once and store** — create the ID before calling `freeze()`, save it to your database, and reuse the same value on retries
- **Never regenerate at the call site** — calling `crypto.randomUUID()` inside `freeze()` produces a different ID on every attempt, breaking idempotency
- **Unique within your project** — two different billing operations must not share the same `businessId`

```typescript
// Wrong — new UUID on every call, idempotency broken on retry
await vb.billing.freeze({
  customerId,
  amount: 50,
  businessId: `${customerId}_${crypto.randomUUID()}`, // ❌ regenerated each time
});

// Correct — UUID generated once and persisted before calling freeze
const businessId = await db.getOrCreateBusinessId(operationId, customerId);
// e.g. returns existing ID or stores `${customerId}_${crypto.randomUUID()}` on first call

await vb.billing.freeze({ customerId, amount: 50, businessId });
// Safe to retry — same businessId returns the original result
await vb.billing.freeze({ customerId, amount: 50, businessId });
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
    businessId: 'job_xyz',
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
