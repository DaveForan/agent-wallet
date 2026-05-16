import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { ClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { CustodyProvider } from "../custody/custody.ts";
import { WalletError } from "../core/errors.ts";
import {
  compareMoney,
  formatMoney,
  type Money,
  type Payee,
  type PaymentRequest,
  type RailId,
} from "../core/types.ts";
import type { PaymentRail, RailQuote, SettlementResult } from "./rail.ts";

/** EVM networks this rail can settle on. */
export type X402Network = "base" | "base-sepolia" | "ethereum" | "polygon";

/** CAIP-2 chain identifiers for each supported network. */
const CAIP2: Record<X402Network, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  ethereum: "eip155:1",
  polygon: "eip155:137",
};

export interface X402RailOptions {
  /** EVM network to settle on. Defaults to Base Sepolia (testnet). */
  network?: X402Network;
}

/**
 * The x402 crypto rail (protocol v2).
 *
 * x402 pays for access to an HTTP resource: a request to the resource URL is
 * answered with `402 Payment Required` and a set of payment requirements; the
 * rail signs a gasless EIP-3009 USDC authorization and retries. A facilitator
 * verifies and settles on-chain and sponsors the gas — so the wallet account
 * needs USDC only, no native ETH.
 *
 * Signing is delegated to the `CustodyProvider`: the rail asks custody for the
 * account address and for an EIP-712 signature, and never touches the key.
 */
export class X402Rail implements PaymentRail {
  readonly id: RailId = "x402";
  private readonly opts: X402RailOptions;

  constructor(opts: X402RailOptions = {}) {
    this.opts = opts;
  }

  /** x402 pays HTTP resources, so a payee is supported iff it is a URL. */
  supports(payee: Payee): boolean {
    return /^https?:\/\//i.test(payee.address);
  }

  /**
   * Probe the resource to read its real, server-declared price. This sends an
   * unpaid request: the 402 response carries the payment requirements.
   */
  async quote(req: PaymentRequest): Promise<RailQuote> {
    const url = this.resourceUrl(req.payee);
    const probe = await fetch(url, { method: "GET" });
    if (probe.status !== 402) {
      throw new WalletError(
        `x402 quote: ${url} returned ${probe.status}, not 402 — it is not a ` +
          `payable x402 resource`,
      );
    }

    let body: unknown;
    try {
      body = await probe.clone().json();
    } catch {
      body = undefined;
    }
    const required = new x402HTTPClient(
      new x402Client(),
    ).getPaymentRequiredResponse((name) => probe.headers.get(name), body);

    const caip2 = CAIP2[this.network()];
    const match = required.accepts.find((r) => r.network === caip2);
    if (!match) {
      const offered = required.accepts.map((r) => r.network).join(", ") || "none";
      throw new WalletError(
        `x402 quote: ${url} cannot be paid on ${this.network()} ` +
          `(networks offered: ${offered})`,
      );
    }

    const timeoutMs = (match.maxTimeoutSeconds || 60) * 1000;
    return {
      total: { amount: BigInt(match.amount), currency: req.amount.currency },
      // EIP-3009 transfers are gasless — the facilitator sponsors the gas.
      fee: { amount: 0n, currency: req.amount.currency },
      quoteRef: url,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
    };
  }

  /** Sign and pay, then return the on-chain settlement reference. */
  async settle(
    req: PaymentRequest,
    quote: RailQuote,
    custody: CustodyProvider,
  ): Promise<SettlementResult> {
    const url = this.resourceUrl(req.payee);

    // The agent's requested amount is the authorized ceiling. If the resource's
    // real price (from quote) is higher, refuse before signing anything.
    const cmp = compareMoney(quote.total, req.amount);
    if (cmp === undefined || cmp > 0) {
      return {
        settled: false,
        reference: "",
        settledAmount: quote.total,
        raw: {
          error:
            `x402 price ${formatMoney(quote.total)} exceeds the authorized ` +
            `amount ${formatMoney(req.amount)}`,
        },
      };
    }

    const client = new x402Client();
    registerExactEvmScheme(client, { signer: await this.custodySigner(custody) });

    // Hard backstop: never sign above the authorized ceiling, even if the
    // server's price changed between quote and settle.
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
      if (BigInt(selectedRequirements.amount) > req.amount.amount) {
        return {
          abort: true,
          reason:
            `x402 price ${selectedRequirements.amount} exceeds the ` +
            `authorized ${req.amount.amount} ${req.amount.currency}`,
        };
      }
    });

    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    const response = await fetchWithPayment(url, { method: "GET" });
    const result = await new x402HTTPClient(client).processResponse(response);

    switch (result.kind) {
      case "success":
        return {
          settled: true,
          reference: result.settleResponse.transaction,
          settledAmount: {
            amount: BigInt(result.settleResponse.amount ?? quote.total.amount),
            currency: req.amount.currency,
          },
          raw: result.settleResponse,
        };
      case "settle_failed":
        return {
          settled: false,
          reference: result.settleResponse.transaction || "",
          settledAmount: quote.total,
          raw: result.settleResponse,
        };
      case "payment_required":
        throw new WalletError(
          "x402 settle: still payment-required after paying — facilitator " +
            "verification failed",
        );
      case "error":
        throw new WalletError(
          `x402 settle: request to ${url} failed with status ${result.status}`,
        );
      case "passthrough":
        throw new WalletError(`x402 settle: ${url} did not require payment`);
    }
  }

  private network(): X402Network {
    return this.opts.network ?? "base-sepolia";
  }

  private resourceUrl(payee: Payee): string {
    if (!this.supports(payee)) {
      throw new WalletError(
        `x402 pays HTTP resource URLs; "${payee.address}" is not one`,
      );
    }
    return payee.address;
  }

  /**
   * Adapt the generic custody provider into the EVM signer the x402 scheme
   * needs. The rail never holds the private key — custody does the signing.
   */
  private async custodySigner(
    custody: CustodyProvider,
  ): Promise<ClientEvmSigner> {
    const address = await custody.account("x402");
    return {
      address: address as `0x${string}`,
      signTypedData: async (message) => {
        const { signature } = await custody.authorize({
          rail: "x402",
          payload: { kind: "eip712", typedData: message },
        });
        return signature as `0x${string}`;
      },
    };
  }
}
