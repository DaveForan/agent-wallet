/**
 * The wallet's registered funding source — the real payment method that
 * agentic-checkout payment tokens (Stripe Shared Payment Tokens) are minted
 * against. Stored as a reference (`pm_…`), never raw card data.
 */
export interface FundingSource {
  /** Stripe payment method id (`pm_…`) the wallet mints tokens against. */
  paymentMethodId: string;
  /** Card brand, for display (e.g. "visa"). */
  brand?: string;
  /** Last four digits, for display. */
  last4?: string;
  /** Operator-friendly label. */
  label?: string;
  /** ISO-8601 registration timestamp. */
  addedAt: string;
}

/**
 * Storage for the wallet's single funding source. The wallet holds one
 * registered payment method; registering a new one replaces it.
 */
export interface FundingSourceStore {
  get(): FundingSource | undefined;
  set(source: FundingSource): void;
  clear(): void;
}

/** Development funding-source store. Lost on restart. */
export class InMemoryFundingSourceStore implements FundingSourceStore {
  private source: FundingSource | undefined;

  get(): FundingSource | undefined {
    return this.source;
  }

  set(source: FundingSource): void {
    this.source = source;
  }

  clear(): void {
    this.source = undefined;
  }
}
