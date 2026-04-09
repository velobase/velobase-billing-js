import { HttpClient } from "./http";
import {
  assertBusinessType,
} from "./types";
import type {
  ConsumeParams,
  ConsumeResponse,
  CustomerResponse,
  DeductParams,
  DeductResponse,
  DepositParams,
  DepositResponse,
  FreezeParams,
  FreezeResponse,
  UnfreezeParams,
  UnfreezeResponse,
  VelobaseOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://api.velobase.io";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;

class BillingResource {
  constructor(private http: HttpClient) {}

  async freeze(params: FreezeParams): Promise<FreezeResponse> {
    if (params.businessType !== undefined) {
      assertBusinessType(params.businessType);
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
}

export class Velobase {
  readonly billing: BillingResource;
  readonly customers: CustomersResource;

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
  }
}
