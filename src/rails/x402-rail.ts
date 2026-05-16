import type { CustodyProvider } from "../custody/custody.ts";
import { NotImplementedError } from "../core/errors.ts";
import type { Payee, PaymentRequest, RailId } from "../core/types.ts";
import type { PaymentRail, RailQuote, SettlementResult } from "./rail.ts";

/** Networks x402 can settle on. */
export type X402Network =
  | "base"
  | "base-sepolia"
  | "solana"
  | "ethereum"
  | "polygon";

export interface X402RailOptions {
  /** Chain to settle on. Defaults to Base. */
  network?: X402Network;
  /** Facilitator URL used to verify and settle payments. */
  facilitatorUrl?: string;
}

/**
 * The x402 crypto rail.
 *
 * x402 revives HTTP 402: a resource server answers a request with payment
 * requirements, the client pays on-chain (typically USDC on Base) and retries.
 * This rail will wrap Coinbase's x402 SDK and a facilitator for verify/settle.
 *
 * STATUS: stubbed. `supports()` works; `quote()`/`settle()` await SDK wiring.
 */
export class X402Rail implements PaymentRail {
  readonly id: RailId = "x402";
  private readonly opts: X402RailOptions;

  constructor(opts: X402RailOptions = {}) {
    this.opts = opts;
  }

  supports(payee: Payee): boolean {
    // x402 payees are HTTP hosts, EVM addresses, or base58 (Solana) addresses.
    return /^(https?:\/\/|0x[0-9a-fA-F]{40}$|[1-9A-HJ-NP-Za-km-z]{32,44}$)/.test(
      payee.address,
    );
  }

  async quote(_req: PaymentRequest): Promise<RailQuote> {
    throw new NotImplementedError(
      `x402 quote (network=${this.opts.network ?? "base"}) — wire the x402 SDK`,
    );
  }

  async settle(
    _req: PaymentRequest,
    _quote: RailQuote,
    _custody: CustodyProvider,
  ): Promise<SettlementResult> {
    throw new NotImplementedError("x402 settle — wire the x402 facilitator");
  }
}
