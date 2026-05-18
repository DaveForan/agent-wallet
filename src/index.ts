/**
 * agent-wallet — a policy-governed payment wallet for autonomous agents.
 *
 * Public API surface. See README.md for the architecture.
 */

export * from "./core/types.ts";
export * from "./core/errors.ts";
export * from "./core/ledger.ts";
export * from "./core/mandates.ts";
export * from "./core/approvals.ts";
export * from "./core/control.ts";
export * from "./core/funding.ts";
export * from "./core/verification.ts";
export * from "./core/policy.ts";
export * from "./core/wallet.ts";

export * from "./acp/types.ts";
export * from "./acp/acp-client.ts";

export * from "./storage/codec.ts";
export * from "./storage/db.ts";
export * from "./storage/sqlite-ledger.ts";
export * from "./storage/sqlite-mandate-store.ts";
export * from "./storage/sqlite-approval-store.ts";
export * from "./storage/sqlite-control-state.ts";
export * from "./storage/sqlite-funding-store.ts";

export * from "./rails/rail.ts";
export { X402Rail, type X402Network, type X402RailOptions } from "./rails/x402-rail.ts";
export { StripeRail, type StripeRailOptions } from "./rails/stripe-rail.ts";
export {
  AcpCheckoutRail,
  type AcpCheckoutRailOptions,
} from "./rails/acp-rail.ts";

export * from "./custody/custody.ts";
export { ManagedCustody, type ManagedCustodyOptions } from "./custody/managed-custody.ts";
export { LocalCustody, type LocalCustodyOptions } from "./custody/local-custody.ts";

export * from "./surfaces/mcp-server.ts";
export * from "./surfaces/http-util.ts";
export * from "./surfaces/http-api.ts";
export * from "./surfaces/control-api.ts";
export * from "./surfaces/control-ui.ts";
export * from "./surfaces/x402-interceptor.ts";
