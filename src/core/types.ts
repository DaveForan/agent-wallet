/**
 * Core domain types for agent-wallet.
 *
 * Everything here is rail-agnostic. A "rail" (x402, Stripe) is just a way to
 * move value; these types describe *what* is being moved and *who authorized
 * it* — never how.
 */

/** A monetary amount in the smallest indivisible unit, to avoid float drift. */
export interface Money {
  /** Integer amount in minor units: cents for USD, atomic token units for crypto. */
  amount: bigint;
  /** ISO-4217 code for fiat ("USD") or token symbol for crypto ("USDC"). */
  currency: string;
}

/** Identifier for a configured payment rail. */
export type RailId = "x402" | "stripe";

/**
 * How the payment was initiated.
 * - `deliberate`: the agent explicitly called a pay tool (MCP / HTTP surface).
 * - `ambient`: the x402 interceptor paid transparently to satisfy an HTTP 402.
 */
export type PaymentChannel = "deliberate" | "ambient";

/** Where money is going. Fields are interpreted per-rail. */
export interface Payee {
  /** Rail-specific destination: an EVM address, an x402 host, a Stripe merchant id. */
  address: string;
  /** Human-readable label / merchant name, for the audit log and approval UI. */
  label?: string;
  /** Merchant category (e.g. Stripe MCC), used by category-scoped mandates. */
  category?: string;
}

/** A request from an agent to move money. The agent is an untrusted caller. */
export interface PaymentRequest {
  id: string;
  rail: RailId;
  channel: PaymentChannel;
  amount: Money;
  payee: Payee;
  /** Free-form justification supplied by the agent. Recorded; never trusted. */
  memo?: string;
  /** The mandate this spend is drawn against, if any. */
  mandateId?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * A mandate is a grant of spending authority from a human principal to the
 * wallet — modelled on AP2's mandate concept. Policy is enforced against it.
 */
export interface Mandate {
  id: string;
  /** Identifier of the human/principal who granted the authority. */
  grantedBy: string;
  /** Lifetime spend ceiling for this mandate. */
  cap: Money;
  /** Optional ceiling for any single payment. */
  perTxnCap?: Money;
  /** Optional rolling-window ceiling, e.g. $50 per 24h. */
  window?: { cap: Money; durationMs: number };
  /** Rails this mandate may use. Undefined/empty means any rail. */
  rails?: RailId[];
  /** Allowed payee addresses/hosts. Undefined/empty means any payee. */
  allowedPayees?: string[];
  /** Allowed merchant categories. Undefined/empty means any category. */
  allowedCategories?: string[];
  /** ISO-8601 expiry. Undefined means no expiry. */
  expiresAt?: string;
  /** Set true to permanently disable the mandate. */
  revoked?: boolean;
}

/** The three things policy can decide about a payment request. */
export type DecisionOutcome = "allow" | "deny" | "needs_approval";

/** The output of the policy engine — always carries a human-readable reason. */
export interface PolicyDecision {
  outcome: DecisionOutcome;
  /** Why this outcome was reached. Always populated, for the audit trail. */
  reason: string;
}

/** How autonomously the wallet may spend without a human in the loop. */
export type AutonomyMode = "tiered" | "autonomous" | "approve-every";

/** Configuration for the policy engine. Autonomy is config, not code paths. */
export interface PolicyConfig {
  /**
   * - `autonomous`: allow anything a mandate permits, no human approval.
   * - `approve-every`: every payment needs human approval.
   * - `tiered`: auto-approve at/under `autoApproveThreshold`, escalate above.
   */
  mode: AutonomyMode;
  /** For `tiered` mode: the auto-approve ceiling. */
  autoApproveThreshold?: Money;
  /** Absolute ceiling — payments above this are denied regardless of mandate. */
  hardLimit?: Money;
  /** If true, a payment with no mandate is escalated for approval. */
  requireMandate?: boolean;
}

/** Construct a Money value. Numbers are rounded to the nearest minor unit. */
export function money(amount: bigint | number, currency: string): Money {
  return {
    amount: typeof amount === "bigint" ? amount : BigInt(Math.round(amount)),
    currency,
  };
}

/**
 * Compare two Money values.
 * Returns -1 | 0 | 1, or `undefined` if the currencies differ (incomparable).
 */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 | undefined {
  if (a.currency !== b.currency) return undefined;
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

/** Add two Money values. Throws on currency mismatch — callers must pre-check. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`cannot add ${a.currency} and ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Format a Money value for logs / UI. */
export function formatMoney(m: Money): string {
  return `${m.amount} ${m.currency}`;
}

/**
 * A `JSON.stringify` replacer that renders bigint values as strings.
 * `Money.amount` is a bigint, which JSON cannot serialise natively.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
