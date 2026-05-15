/**
 * GENERATED — do not edit by hand.
 *
 * Mirrors `velobase-internal/src/server/errors/codes.ts` so the SDK
 * can expose a stable `VelobaseErrorCode` union for client-side
 * `switch (err.code)` and IDE autocomplete.
 *
 * Sync policy: server CI fails if `codes.ts` changes without bumping
 * this file + the SDK version. See `docs/error-system-design.md` §5.4.
 */

export type VelobaseErrorType =
  | "bad_request"
  | "auth_error"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unprocessable"
  | "server_error"
  | "upstream_error";

/**
 * Every known error code, kept in lockstep with the server registry.
 *
 * The `(string & {})` opens the union so that:
 *   1. clients still get IDE autocomplete on the known codes;
 *   2. server-side additions never break SDK consumers — an unknown
 *      `err.code` is typed as `string` and degrades to the `type`
 *      bucket for fallback handling.
 */
export type VelobaseErrorCode =
  // ─── Auth (401) ──────────────────────────────────────
  | "missing_api_key"
  | "invalid_api_key"
  | "api_key_revoked"
  // ─── Validation: required (400) ──────────────────────
  | "customer_id_required"
  | "transaction_id_required"
  | "amount_must_be_positive"
  | "actual_amount_must_be_non_negative"
  | "wallet_required"
  | "resource_id_required"
  | "feature_key_required"
  | "value_required"
  // ─── Validation: format (400) ────────────────────────
  | "invalid_starts_at"
  | "invalid_expires_at"
  | "invalid_datetime_range"
  | "invalid_limit"
  | "invalid_operation_type"
  | "invalid_valid_from"
  | "invalid_valid_until"
  | "invalid_from_at"
  | "invalid_to_at"
  // ─── Routing: not found (404) ────────────────────────
  | "customer_not_found"
  | "entitlement_customer_not_found"
  | "slot_pool_not_found"
  | "slot_holding_not_found"
  // ─── Balance & deduction (400) ───────────────────────
  | "insufficient_balance"
  | "no_consumable_freeze_records"
  | "freeze_records_already_consumed"
  | "no_unfreezable_records"
  // ─── Slot (400) ──────────────────────────────────────
  | "slot_capacity_below_in_use"
  | "slot_insufficient_capacity"
  | "slot_split_required"
  // ─── Entitlement (400) ───────────────────────────────
  | "entitlement_validation_error"
  // ─── Conflicts (409) ─────────────────────────────────
  | "transaction_conflict"
  | "customer_scope_mismatch"
  // ─── Rate limit (429) ────────────────────────────────
  | "usage_limit_exceeded"
  // ─── Internal (500) ──────────────────────────────────
  | "billing_account_not_found"
  | "inconsistent_grant_record"
  | "freeze_records_inconsistent"
  | "slot_internal_inconsistency"
  | "server_error"
  // ─── Forward-compat escape hatch ─────────────────────
  | (string & {});
