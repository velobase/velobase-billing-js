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
  | 'TOKEN_USAGE'
  | (string & {});

const VALID_BUSINESS_TYPES = new Set([
  'UNDEFINED',
  'TASK',
  'ORDER',
  'MEMBERSHIP',
  'SUBSCRIPTION',
  'FREE_TRIAL',
  'ADMIN_GRANT',
  'TOKEN_USAGE',
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
  wallet?: string;
  businessType?: BusinessType;
  description?: string;
  /**
   * If set, the platform auto-unfreezes this freeze after `unfreezeAfterSeconds`
   * seconds if it is still FROZEN. Mutually exclusive with `consumeAfterSeconds`.
   * Range: [1, 30 days].
   */
  unfreezeAfterSeconds?: number;
  /**
   * If set, the platform auto-consumes the full frozen amount after
   * `consumeAfterSeconds` seconds if it is still FROZEN. Mutually exclusive
   * with `unfreezeAfterSeconds`. Range: [1, 7 days]. Irreversible — prefer
   * `unfreezeAfterSeconds` unless your business model commits on inaction.
   */
  consumeAfterSeconds?: number;
}

export interface FreezeResponse {
  transactionId: string;
  frozenAmount: number;
  freezeDetails: unknown[];
  /** Absolute ISO timestamp when scheduler will auto-unfreeze, or null. */
  unfreezeAfter: string | null;
  /** Absolute ISO timestamp when scheduler will auto-consume, or null. */
  consumeAfter: string | null;
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
  overageAmount?: number;
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
  wallet?: string;
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
  wallet?: string;
  source?: string;
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
  wallet: string;
  source: string;
  totalAmount: number;
  addedAmount: number;
  startsAt: string | null;
  expiresAt: string | null;
  recordId: string;
  isIdempotentReplay: boolean;
}

// ─── Customer ────────────────────────────────────────────────────

export interface WalletSource {
  source: string;
  total: number;
  used: number;
  frozen: number;
  available: number;
  startsAt: string | null;
  expiresAt: string | null;
}

export interface WalletBalance {
  total: number;
  used: number;
  frozen: number;
  available: number;
  sources: WalletSource[];
}

export interface CustomerResponse {
  id: string;
  name: string | null;
  email: string | null;
  metadata: Record<string, unknown> | null;
  wallets: Record<string, WalletBalance>;
  createdAt: string;
}

// ─── Ledger ─────────────────────────────────────────────────────

export interface LedgerParams {
  limit?: number;
  cursor?: string;
  operationType?: string;
  transactionId?: string;
}

export interface LedgerEntry {
  id: string;
  operationType: string;
  amount: number;
  wallet: string;
  source: string;
  transactionId: string | null;
  businessType: string;
  description: string | null;
  accountId: string;
  status: string;
  createdAt: string;
}

export interface LedgerResponse {
  items: LedgerEntry[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

// ─── Client Options ──────────────────────────────────────────────

export interface VelobaseOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

// ─── Slot Subsystem ──────────────────────────────────────────────

export type SlotEventType =
  | 'GRANT_CAPACITY'
  | 'REVOKE_CAPACITY'
  | 'CLAIM'
  | 'RELEASE';

export type SlotPoolStatus = 'ACTIVE' | 'SUSPENDED';

export interface SlotPoolView {
  poolId: string;
  wallet: string;
  source: string;
  capacity: number;
  inUse: number;
  available: number;
  status: SlotPoolStatus;
  isIdempotentReplay?: boolean;
}

export interface GrantCapacityParams {
  customerId: string;
  wallet: string;
  source?: string;
  amount: number;
  idempotencyKey?: string;
  description?: string;
}

export type GrantCapacityResponse = SlotPoolView;

export interface RevokeCapacityParams extends GrantCapacityParams {}

export type RevokeCapacityResponse = SlotPoolView;

export interface ClaimSlotParams {
  customerId: string;
  wallet: string;
  source?: string;
  resourceId: string;
  amount?: number;
  description?: string;
}

export interface ClaimSlotResponse extends SlotPoolView {
  holdingId: string;
}

export interface ReleaseSlotParams {
  customerId: string;
  wallet: string;
  resourceId: string;
}

export interface ReleaseSlotResponse extends SlotPoolView {
  holdingId: string;
}

export interface SlotPoolSummary {
  poolId: string;
  wallet: string;
  source: string;
  capacity: number;
  inUse: number;
  available: number;
  status: SlotPoolStatus;
}

export interface GetCustomerSlotsResponse {
  pools: SlotPoolSummary[];
}

export interface ListSlotEventsParams {
  wallet?: string;
  sources?: string[];
  types?: SlotEventType[];
  resourceId?: string;
  fromAt?: string;
  toAt?: string;
  cursor?: string;
  limit?: number;
}

export interface SlotEventEntry {
  id: string;
  type: SlotEventType;
  wallet: string;
  source: string;
  amount: number;
  resourceId: string | null;
  description: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface ListSlotEventsResponse {
  items: SlotEventEntry[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

// ─── Entitlement Subsystem ───────────────────────────────────────

export type EntitlementEventType = 'SET' | 'REMOVE';

export interface EntitlementView {
  entitlementId: string;
  featureKey: string;
  value: string;
  validFrom: string | null;
  validUntil: string | null;
  source: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SetEntitlementParams {
  customerId: string;
  featureKey: string;
  value: string;
  validFrom?: string | null;
  validUntil?: string | null;
  source?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SetEntitlementResponse extends EntitlementView {
  isCreated: boolean;
  oldValue: string | null;
}

export interface GetEntitlementParams {
  customerId: string;
  featureKey: string;
}

export interface GetEntitlementResponse {
  entitlement: EntitlementView | null;
}

export interface ListEntitlementsParams {
  customerId: string;
  featureKeys?: string[];
  includeExpired?: boolean;
}

export interface ListEntitlementsItem extends EntitlementView {
  isActive: boolean;
}

export interface ListEntitlementsResponse {
  items: ListEntitlementsItem[];
}

export interface RemoveEntitlementParams {
  customerId: string;
  featureKey: string;
}

export interface RemoveEntitlementResponse {
  removed: boolean;
  oldValue: string | null;
}

export interface ListEntitlementEventsParams {
  customerId: string;
  featureKey?: string;
  types?: EntitlementEventType[];
  fromAt?: string;
  toAt?: string;
  cursor?: string;
  limit?: number;
}

export interface EntitlementEventEntry {
  id: string;
  featureKey: string;
  type: EntitlementEventType;
  oldValue: string | null;
  newValue: string | null;
  source: string | null;
  description: string | null;
  createdAt: string;
}

export interface ListEntitlementEventsResponse {
  items: EntitlementEventEntry[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}
