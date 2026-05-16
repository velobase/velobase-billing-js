import { HttpClient } from "./http";
import {
  assertBusinessType,
} from "./types";
import type {
  ClaimSlotParams,
  ClaimSlotResponse,
  ConsumeParams,
  ConsumeResponse,
  CustomerResponse,
  DeductParams,
  DeductResponse,
  DepositParams,
  DepositResponse,
  FreezeParams,
  FreezeResponse,
  GetCustomerSlotsResponse,
  GetEntitlementParams,
  GetEntitlementResponse,
  GrantCapacityParams,
  GrantCapacityResponse,
  LedgerParams,
  LedgerResponse,
  ListEntitlementEventsParams,
  ListEntitlementEventsResponse,
  ListEntitlementsParams,
  ListEntitlementsResponse,
  ListSlotEventsParams,
  ListSlotEventsResponse,
  ReleaseSlotParams,
  ReleaseSlotResponse,
  RemoveEntitlementParams,
  RemoveEntitlementResponse,
  RevokeCapacityParams,
  RevokeCapacityResponse,
  SetEntitlementParams,
  SetEntitlementResponse,
  UnfreezeParams,
  UnfreezeResponse,
  VelobaseOptions,
} from "./types";


const DEFAULT_BASE_URL = "https://api.velobase.io";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;

// Single-shot warning dedupe per process. We never want to spam the console
// when freeze() is called in a hot loop without a TTL field.
let autoSettlementWarningEmitted = false;

class BillingResource {
  constructor(private http: HttpClient) {}

  async freeze(params: FreezeParams): Promise<FreezeResponse> {
    if (params.businessType !== undefined) {
      assertBusinessType(params.businessType);
    }
    // Mutual exclusion: both auto-settlement TTLs at once is meaningless.
    // Fail loud on the client to avoid an extra HTTP round-trip.
    if (
      params.unfreezeAfterSeconds !== undefined &&
      params.consumeAfterSeconds !== undefined
    ) {
      throw new Error(
        "freeze() accepts at most one of unfreezeAfterSeconds / consumeAfterSeconds, not both",
      );
    }
    // Deprecation warning: neither TTL → freeze will never auto-settle. Caller
    // is on the hook to call consume() or unfreeze() themselves. Future major
    // versions may require an explicit choice.
    if (
      params.unfreezeAfterSeconds === undefined &&
      params.consumeAfterSeconds === undefined &&
      !autoSettlementWarningEmitted
    ) {
      autoSettlementWarningEmitted = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[velobase-billing] freeze() called without unfreezeAfterSeconds or consumeAfterSeconds. " +
          "This freeze will never auto-settle. Future major versions may require an explicit choice.",
      );
    }
    return this.http.request<FreezeResponse>(
      "POST",
      "/v1/billing/freeze",
      params,
    );
  }

  async consume(params: ConsumeParams): Promise<ConsumeResponse> {
    return this.http.request<ConsumeResponse>(
      "POST",
      "/v1/billing/consume",
      params,
    );
  }

  async unfreeze(params: UnfreezeParams): Promise<UnfreezeResponse> {
    return this.http.request<UnfreezeResponse>(
      "POST",
      "/v1/billing/unfreeze",
      params,
    );
  }

  async deduct(params: DeductParams): Promise<DeductResponse> {
    if (params.businessType !== undefined) {
      assertBusinessType(params.businessType);
    }
    return this.http.request<DeductResponse>(
      "POST",
      "/v1/billing/deduct",
      params,
    );
  }
}

class CustomersResource {
  constructor(private http: HttpClient) {}

  async deposit(params: DepositParams): Promise<DepositResponse> {
    const headers: Record<string, string> = {};
    if (params.idempotencyKey) {
      headers["Idempotency-Key"] = params.idempotencyKey;
    }
    return this.http.request<DepositResponse>(
      "POST",
      "/v1/customers/deposit",
      params,
      headers,
    );
  }

  async get(customerId: string): Promise<CustomerResponse> {
    return this.http.request<CustomerResponse>(
      "GET",
      `/v1/customers/${encodeURIComponent(customerId)}`,
    );
  }

  async ledger(
    customerId: string,
    params?: LedgerParams,
  ): Promise<LedgerResponse> {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.operationType) qs.set("operation_type", params.operationType);
    if (params?.transactionId) qs.set("transaction_id", params.transactionId);

    const query = qs.toString();
    const path = `/v1/customers/${encodeURIComponent(customerId)}/ledger${query ? `?${query}` : ""}`;
    return this.http.request<LedgerResponse>("GET", path);
  }
}

class SlotResource {
  constructor(private http: HttpClient) {}

  async grantCapacity(params: GrantCapacityParams): Promise<GrantCapacityResponse> {
    return this.http.request<GrantCapacityResponse>(
      "POST",
      "/v1/slot/grant",
      params,
    );
  }

  async revokeCapacity(params: RevokeCapacityParams): Promise<RevokeCapacityResponse> {
    return this.http.request<RevokeCapacityResponse>(
      "POST",
      "/v1/slot/revoke",
      params,
    );
  }

  async claim(params: ClaimSlotParams): Promise<ClaimSlotResponse> {
    return this.http.request<ClaimSlotResponse>(
      "POST",
      "/v1/slot/claim",
      params,
    );
  }

  async release(params: ReleaseSlotParams): Promise<ReleaseSlotResponse> {
    return this.http.request<ReleaseSlotResponse>(
      "POST",
      "/v1/slot/release",
      params,
    );
  }

  async getCustomer(
    customerId: string,
    opts?: { wallet?: string },
  ): Promise<GetCustomerSlotsResponse> {
    const qs = new URLSearchParams();
    if (opts?.wallet) qs.set("wallet", opts.wallet);
    const query = qs.toString();
    const path = `/v1/slot/customer/${encodeURIComponent(customerId)}${query ? `?${query}` : ""}`;
    return this.http.request<GetCustomerSlotsResponse>("GET", path);
  }

  async listEvents(
    customerId: string,
    params?: ListSlotEventsParams,
  ): Promise<ListSlotEventsResponse> {
    const qs = new URLSearchParams();
    if (params?.wallet) qs.set("wallet", params.wallet);
    if (params?.resourceId) qs.set("resource_id", params.resourceId);
    if (params?.cursor) qs.set("cursor", params.cursor);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.types && params.types.length > 0) {
      qs.set("types", params.types.join(","));
    }
    if (params?.sources && params.sources.length > 0) {
      qs.set("sources", params.sources.join(","));
    }
    if (params?.fromAt) qs.set("from_at", params.fromAt);
    if (params?.toAt) qs.set("to_at", params.toAt);
    const query = qs.toString();
    const path = `/v1/slot/events/${encodeURIComponent(customerId)}${query ? `?${query}` : ""}`;
    return this.http.request<ListSlotEventsResponse>("GET", path);
  }
}

class EntitlementResource {
  constructor(private http: HttpClient) {}

  async setEntitlement(params: SetEntitlementParams): Promise<SetEntitlementResponse> {
    return this.http.request<SetEntitlementResponse>(
      "POST",
      "/v1/entitlement/set",
      params,
    );
  }

  async getEntitlement(
    params: GetEntitlementParams,
  ): Promise<GetEntitlementResponse> {
    const path = `/v1/entitlement/${encodeURIComponent(params.customerId)}/${encodeURIComponent(params.featureKey)}`;
    return this.http.request<GetEntitlementResponse>("GET", path);
  }

  async listEntitlements(
    params: ListEntitlementsParams,
  ): Promise<ListEntitlementsResponse> {
    const qs = new URLSearchParams();
    if (params.featureKeys && params.featureKeys.length > 0) {
      qs.set("feature_keys", params.featureKeys.join(","));
    }
    if (params.includeExpired) qs.set("include_expired", "true");
    const query = qs.toString();
    const path = `/v1/entitlement/${encodeURIComponent(params.customerId)}${query ? `?${query}` : ""}`;
    return this.http.request<ListEntitlementsResponse>("GET", path);
  }

  async removeEntitlement(
    params: RemoveEntitlementParams,
  ): Promise<RemoveEntitlementResponse> {
    return this.http.request<RemoveEntitlementResponse>(
      "POST",
      "/v1/entitlement/remove",
      params,
    );
  }

  async listEvents(
    params: ListEntitlementEventsParams,
  ): Promise<ListEntitlementEventsResponse> {
    const qs = new URLSearchParams();
    if (params.featureKey) qs.set("feature_key", params.featureKey);
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.types && params.types.length > 0) {
      qs.set("types", params.types.join(","));
    }
    if (params.fromAt) qs.set("from_at", params.fromAt);
    if (params.toAt) qs.set("to_at", params.toAt);
    const query = qs.toString();
    const path = `/v1/entitlement/${encodeURIComponent(params.customerId)}/events${query ? `?${query}` : ""}`;
    return this.http.request<ListEntitlementEventsResponse>("GET", path);
  }
}

export class Velobase {
  readonly billing: BillingResource;
  readonly customers: CustomersResource;
  readonly slot: SlotResource;
  readonly entitlement: EntitlementResource;

  constructor(opts: VelobaseOptions) {
    if (!opts.apiKey) {
      throw new Error(
        "apiKey is required. Get your API key at https://velobase.io",
      );
    }

    const http = new HttpClient({
      baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: opts.apiKey,
      timeout: opts.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    this.billing = new BillingResource(http);
    this.customers = new CustomersResource(http);
    this.slot = new SlotResource(http);
    this.entitlement = new EntitlementResource(http);
  }
}
