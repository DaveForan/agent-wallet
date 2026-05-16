import { NotImplementedError } from "../core/errors.ts";
import type { RailId } from "../core/types.ts";
import type {
  Authorization,
  CustodyProvider,
  SigningRequest,
} from "./custody.ts";

export interface LocalCustodyOptions {
  /** Path to the encrypted key store. */
  keystorePath?: string;
}

/**
 * Self-custody — the wallet holds its own private keys locally.
 *
 * Gives full control at the cost of owning all key-security risk. When this is
 * built it should keep keys in an OS keychain / encrypted store, and ideally
 * isolate signing in a separate hardened process.
 *
 * STATUS: stubbed. Deliberately unimplemented until the custody model is fixed.
 */
export class LocalCustody implements CustodyProvider {
  readonly kind = "local" as const;
  private readonly opts: LocalCustodyOptions;

  constructor(opts: LocalCustodyOptions = {}) {
    this.opts = opts;
  }

  async account(rail: RailId): Promise<string> {
    throw new NotImplementedError(`local custody account for ${rail}`);
  }

  async authorize(_request: SigningRequest): Promise<Authorization> {
    throw new NotImplementedError(
      `local custody authorize (keystore=${this.opts.keystorePath ?? "unset"})`,
    );
  }
}
