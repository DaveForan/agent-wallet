import { NotImplementedError } from "../core/errors.ts";
import type { RailId } from "../core/types.ts";
import type {
  Authorization,
  CustodyProvider,
  SigningRequest,
} from "./custody.ts";

export interface ManagedCustodyOptions {
  /** Coinbase CDP API key for crypto custody. */
  cdpApiKey?: string;
  /** CDP server-wallet id that holds the crypto funds. */
  cdpWalletId?: string;
}

/**
 * Managed custody — keys and funds held by a provider (Coinbase CDP server
 * wallets for crypto, Stripe for the card). No private keys touch this
 * process, which keeps the v1 attack surface small.
 *
 * STATUS: stubbed. Awaiting CDP SDK / KMS wiring.
 */
export class ManagedCustody implements CustodyProvider {
  readonly kind = "managed" as const;
  private readonly opts: ManagedCustodyOptions;

  constructor(opts: ManagedCustodyOptions = {}) {
    this.opts = opts;
  }

  async account(rail: RailId): Promise<string> {
    throw new NotImplementedError(
      `managed custody account for ${rail} — wire the CDP SDK`,
    );
  }

  async authorize(_request: SigningRequest): Promise<Authorization> {
    throw new NotImplementedError(
      this.opts.cdpWalletId
        ? "managed custody authorize — wire the CDP signing API"
        : "managed custody authorize — no cdpWalletId configured",
    );
  }
}
