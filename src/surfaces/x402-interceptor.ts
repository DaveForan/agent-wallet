import { guardedFetch } from "../core/net-guard.ts";
import { compareMoney, type Money } from "../core/types.ts";
import type { WalletDaemon } from "../core/wallet.ts";

/**
 * x402 interceptor — the *ambient* payment surface.
 *
 * Wraps `fetch`: when a server answers HTTP 402, it reads the payment
 * requirements, asks the wallet to pay (channel: "ambient", so the agent never
 * spends a reasoning token on it) and retries the original request.
 *
 * The agent just calls fetch; paying for metered APIs becomes invisible — but
 * still fully governed by the same policy engine and ledger.
 */

export interface X402Challenge {
  /** Where to pay. */
  payTo: string;
  /** What it costs. */
  amount: Money;
  /** Echoed back on the retry so the server can match the payment. */
  nonce?: string;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PayingFetchOptions {
  /** Underlying fetch. Defaults to an SSRF-guarded fetch. */
  baseFetch?: FetchLike;
  /** Mandate that ambient payments are drawn against. */
  mandateId?: string;
  /** Hard cap on a single ambient payment, checked before the wallet is asked. */
  maxPerCall?: Money;
  /** Allow loopback / private targets — for local testing only. */
  allowPrivate?: boolean;
}

/** Build a fetch that transparently satisfies x402 challenges via the wallet. */
export function createPayingFetch(
  wallet: WalletDaemon,
  opts: PayingFetchOptions = {},
): FetchLike {
  const baseFetch: FetchLike =
    opts.baseFetch ?? guardedFetch({ allowPrivate: opts.allowPrivate });

  return async function payingFetch(input, init) {
    const first = await baseFetch(input, init);
    if (first.status !== 402) return first;

    const challenge = parseX402Challenge(first);
    if (!challenge) return first;

    if (opts.maxPerCall) {
      const cmp = compareMoney(challenge.amount, opts.maxPerCall);
      if (cmp === undefined || cmp > 0) return first; // over the local cap
    }

    const result = await wallet.pay({
      rail: "x402",
      channel: "ambient",
      amount: challenge.amount,
      payee: { address: challenge.payTo, label: "x402 resource" },
      memo: `x402 challenge for ${String(input)}`,
      mandateId: opts.mandateId,
    });

    if (result.status !== "settled") {
      // Hand the original 402 back; the caller decides how to degrade.
      return first;
    }

    // Retry with proof of payment attached.
    const headers = new Headers(init?.headers);
    headers.set("x-payment", result.settlement.reference);
    return baseFetch(input, { ...init, headers });
  };
}

/** Parse an x402 challenge from a 402 response's header. */
export function parseX402Challenge(res: Response): X402Challenge | undefined {
  const header = res.headers.get("x-payment-required");
  if (!header) return undefined;
  try {
    const parsed = JSON.parse(header) as {
      payTo?: string;
      amount?: string | number;
      currency?: string;
      nonce?: string;
    };
    if (!parsed.payTo || parsed.amount === undefined || !parsed.currency) {
      return undefined;
    }
    return {
      payTo: parsed.payTo,
      amount: { amount: BigInt(parsed.amount), currency: parsed.currency },
      nonce: parsed.nonce,
    };
  } catch {
    return undefined;
  }
}
