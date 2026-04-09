export { Velobase } from "./client";
export {
  VelobaseError,
  VelobaseAuthenticationError,
  VelobaseValidationError,
  VelobaseNotFoundError,
  VelobaseConflictError,
  VelobaseInternalError,
} from "./errors";
export type {
  VelobaseOptions,
  BusinessType,
  FreezeParams,
  FreezeResponse,
  ConsumeParams,
  ConsumeResponse,
  UnfreezeParams,
  UnfreezeResponse,
  DeductParams,
  DeductResponse,
  DepositParams,
  DepositResponse,
  CustomerBalance,
  CustomerAccount,
  CustomerResponse,
} from "./types";

// default export for convenience
export { Velobase as default } from "./client";
