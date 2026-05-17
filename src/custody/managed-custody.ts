import { CdpClient } from "@coinbase/cdp-sdk";
import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import { NotImplementedError, WalletError } from "../core/errors.ts";
import type { RailId } from "../core/types.ts";
import type {
  Authorization,
  CustodyProvider,
  SigningRequest,
} from "./custody.ts";

/** Name of the CDP server account the wallet uses, when none is configured. */
const DEFAULT_ACCOUNT_NAME = "agent-wallet";

export interface ManagedCustodyOptions {
  /** CDP API key id. Falls back to the CDP_API_KEY_ID environment variable. */
  apiKeyId?: string;
  /** CDP API key secret. Falls back to CDP_API_KEY_SECRET. */
  apiKeySecret?: string;
  /**
   * CDP wallet secret — required to authorize signing. Falls back to
   * CDP_WALLET_SECRET. Created once in the CDP Portal.
   */
  walletSecret?: string;
  /** Name of the CDP server account to use or create. */
  accountName?: string;
}

/**
 * Managed custody — keys and funds are held by Coinbase CDP server wallets,
 * never by this process. The CDP-held key signs; agent-wallet only ever holds
 * API credentials.
 *
 * Like {@link import("./local-custody.ts").LocalCustody}, one EVM account
 * serves every EVM network, so this backs the `x402` rail. The x402 rail talks
 * only to the generic `CustodyProvider` interface, so switching a wallet from
 * local to managed custody needs no rail changes.
 */
export class ManagedCustody implements CustodyProvider {
  readonly kind = "managed" as const;

  private readonly opts: ManagedCustodyOptions;
  /** Memoised CDP client and account, populated by `ensureAccount()`. */
  private client: CdpClient | undefined;
  private serverAccount: EvmServerAccount | undefined;

  constructor(opts: ManagedCustodyOptions = {}) {
    this.opts = opts;
  }

  /** The EVM address of the CDP server account. */
  async account(rail: RailId): Promise<string> {
    if (rail !== "x402") {
      throw new NotImplementedError(
        `managed custody backs the x402 (EVM) rail; the "${rail}" rail is ` +
          `not key-based`,
      );
    }
    return (await this.ensureAccount()).address;
  }

  /** Sign an EIP-712 typed-data payload using the CDP-held key. */
  async authorize(request: SigningRequest): Promise<Authorization> {
    if (request.rail !== "x402") {
      throw new NotImplementedError(
        `managed custody cannot authorize for the "${request.rail}" rail`,
      );
    }
    const payload = request.payload as { kind?: string; typedData?: unknown };
    if (payload?.kind !== "eip712" || payload.typedData === undefined) {
      throw new WalletError(
        'managed custody: x402 signing expects { kind: "eip712", typedData }',
      );
    }
    const account = await this.ensureAccount();
    const signature = await account.signTypedData(
      payload.typedData as Parameters<EvmServerAccount["signTypedData"]>[0],
    );
    return { signature };
  }

  /**
   * Lazily build the CDP client and resolve the server account, creating it
   * on first use. Credentials left undefined fall back to the CDP_* env vars.
   */
  private async ensureAccount(): Promise<EvmServerAccount> {
    if (this.serverAccount) return this.serverAccount;

    this.client ??= new CdpClient({
      apiKeyId: this.opts.apiKeyId,
      apiKeySecret: this.opts.apiKeySecret,
      walletSecret: this.opts.walletSecret,
    });
    this.serverAccount = await this.client.evm.getOrCreateAccount({
      name: this.opts.accountName ?? DEFAULT_ACCOUNT_NAME,
    });
    return this.serverAccount;
  }
}
