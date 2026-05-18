import type { CustodyProvider } from "../custody/custody.ts";
import type { Money, Payee, PaymentRequest, RailId } from "../core/types.ts";

/** A firm price for a specific payment, valid until `expiresAt`. */
export interface RailQuote {
  /** Total debited from custody, including the network/rail fee. */
  total: Money;
  /** The fee component (network gas, rail fee). May be zero. */
  fee: Money;
  /** Opaque handle the rail needs to settle exactly this quote. */
  quoteRef: string;
  /** ISO-8601 expiry of the quote. */
  expiresAt: string;
}

/** The result of settling a payment on a rail. */
export interface SettlementResult {
  settled: boolean;
  /** Rail-native reference: a tx hash, a Stripe charge id, etc. */
  reference: string;
  /** What was actually moved. */
  settledAmount: Money;
  /**
   * A merchant order, when the payment completed an agentic checkout — the
   * first-class record an operator reconciles against the merchant's books.
   */
  order?: { id: string; sessionId?: string };
  /** Raw rail response, kept for the audit ledger. */
  raw?: unknown;
}

/**
 * A PaymentRail moves value to a payee. Implementations (x402, Stripe) hide all
 * rail-specific mechanics behind this interface, so the WalletDaemon — and the
 * policy engine above it — stay rail-agnostic.
 */
export interface PaymentRail {
  readonly id: RailId;

  /** Can this rail reach the given payee at all? */
  supports(payee: Payee): boolean;

  /** Price a request before committing, so policy can see the true cost. */
  quote(req: PaymentRequest): Promise<RailQuote>;

  /** Execute the payment, drawing funds/signatures from `custody`. */
  settle(
    req: PaymentRequest,
    quote: RailQuote,
    custody: CustodyProvider,
  ): Promise<SettlementResult>;
}
