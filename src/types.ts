// ─── Freeze ──────────────────────────────────────────────────────

/**
 * Enum values accepted by the server for `businessType`.
 * Using `(string & {})` keeps the type open for forward-compatibility while
 * still surfacing these literals in IDE autocomplete.
 */
export type BusinessType =
  | 'UNDEFINED'
  | 'TASK'
  | 'ORDER'
  | 'MEMBERSHIP'
  | 'SUBSCRIPTION'
  | 'FREE_TRIAL'
  | 'ADMIN_GRANT'
  | (string & {});

const VALID_BUSINESS_TYPES = new Set([
  'UNDEFINED',
  'TASK',
  'ORDER',
  'MEMBERSHIP',
  'SUBSCRIPTION',
  'FREE_TRIAL',
  'ADMIN_GRANT',
]);

export function assertBusinessType(value: string): void {
  if (!VALID_BUSINESS_TYPES.has(value)) {
    throw new Error(
      `Invalid businessType: "${value}". ` +
        `Must be one of: ${[...VALID_BUSINESS_TYPES].join(', ')}.`,
    );
  }
}

export interface FreezeParams {
  customerId: string;
  amount: number;
  transactionId: string;
  creditTypes?: string[];
  businessType?: BusinessType;
  description?: string;
}

export interface FreezeResponse {
  transactionId: string;
  frozenAmount: number;
  freezeDetails: unknown[];
  isIdempotentReplay: boolean;
}

// ─── Consume ─────────────────────────────────────────────────────

export interface ConsumeParams {
  transactionId: string;
  actualAmount?: number;
}

export interface ConsumeResponse {
  transactionId: string;
  consumedAmount: number;
  returnedAmount?: number;
  consumeDetails: unknown[];
  consumedAt: string;
  isIdempotentReplay: boolean;
}

// ─── Unfreeze ────────────────────────────────────────────────────

export interface UnfreezeParams {
  transactionId: string;
}

export interface UnfreezeResponse {
  transactionId: string;
  unfrozenAmount: number;
  unfreezeDetails: unknown[];
  unfrozenAt: string;
  isIdempotentReplay: boolean;
}

// ─── Deduct ──────────────────────────────────────────────────────

export interface DeductParams {
  customerId: string;
  amount: number;
  transactionId: string;
  creditTypes?: string[];
  businessType?: BusinessType;
  description?: string;
}

export interface DeductResponse {
  transactionId: string;
  deductedAmount: number;
  deductDetails: unknown[];
  deductedAt: string;
  isIdempotentReplay: boolean;
}

// ─── Deposit ─────────────────────────────────────────────────────

export interface DepositParams {
  customerId: string;
  amount: number;
  creditType?: string;
  startsAt?: string;
  expiresAt?: string;
  idempotencyKey?: string;
  name?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown>;
  description?: string;
}

export interface DepositResponse {
  customerId: string;
  accountId: string;
  creditType: string | null;
  totalAmount: number;
  addedAmount: number;
  startsAt: string | null;
  expiresAt: string | null;
  recordId: string;
  isIdempotentReplay: boolean;
}

// ─── Customer ────────────────────────────────────────────────────

export interface CustomerBalance {
  total: number;
  used: number;
  frozen: number;
  available: number;
}

export interface CustomerAccount {
  accountType: string;
  creditType: string;
  total: number;
  used: number;
  frozen: number;
  available: number;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface CustomerResponse {
  id: string;
  name: string | null;
  email: string | null;
  metadata: Record<string, unknown> | null;
  balance: CustomerBalance;
  accounts: CustomerAccount[];
  createdAt: string;
}

// ─── Client Options ──────────────────────────────────────────────

export interface VelobaseOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}
