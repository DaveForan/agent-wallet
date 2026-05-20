# Payment rails

A **rail** is how value actually moves. The wallet ships three, all behind one
`PaymentRail` interface; the daemon and the policy engine stay rail-agnostic.

## x402 — crypto micropayments

HTTP-402-based stablecoin payments to URL resources. The Coinbase / Cloudflare
standard.

- **Network**: Base Sepolia testnet by default (`X402Rail({ network: "base-sepolia" })`).
  Switch to `"base"` for mainnet.
- **Token**: USDC, EIP-3009 gasless authorisation. A facilitator
  (`x402.org/facilitator`) verifies on-chain and sponsors gas — your custody
  account needs USDC only, no native ETH.
- **What the agent pays**: an HTTP URL that returns `402 Payment Required`
  with the price.

**Verified live**: `npm run x402:check` settles a real Base Sepolia transaction
against a built-in test resource. The address is funded with testnet USDC.

**Custody**: signs through `CustodyProvider` (Local or CDP). The rail never
holds a key.

## Stripe — virtual cards

`StripeRail.settle()` issues a single-use **virtual card** via Stripe Issuing,
spend-limited to the authorised amount.

- **What the agent pays**: a merchant id (the resulting card can be used at
  any card-accepting checkout).
- **Setup**: a Stripe account with Issuing enabled and `STRIPE_SECRET_KEY` (use
  `sk_test_…` for test mode). `npm run stripe:check` skips cleanly without a
  key and refuses a non-`sk_test_` key.
- **Important**: the rail deliberately returns only the card *id* (and brand /
  last4) — never the full PAN. A separate retrieval flow would be required to
  actually charge the card at a merchant, which is why the **ACP rail** is the
  better path for agentic checkout.

## ACP — agentic checkout

The Agentic Commerce Protocol rail (spec `2026-04-17`). Pays an ACP merchant's
checkout session by minting a **Stripe Shared Payment Token** scoped to that
merchant + cart total + a short TTL.

- **What the agent pays**: a verified ACP checkout session at a real merchant.
- **Setup**:
  - Stripe Shared Payment Token program access.
  - A funding source registered with the wallet (the `pm_…` the SPT mints
    against).
  - The merchant's `networkBusinessProfile` (the Stripe seller scope).
- **The token's three constraints — merchant, amount, expiry — *are* the
  policy decision made concrete.** The merchant never sees a card number; the
  agent never holds a reusable credential.

See **[Agentic checkout](/agentic-checkout)** for the full flow.

## Outbound fetches are SSRF-guarded

All three rails make HTTP calls to agent-supplied URLs (x402 resources, ACP
merchant endpoints). `guardedFetch` (see [SSRF in *Security
posture*](/security)) rejects non-HTTP(S) schemes, literal private addresses,
and hostnames that *resolve* into private ranges.

The x402 smoke test connects to `http://localhost:4021` for a built-in test
resource; the rail accepts an `allowPrivate: true` option for exactly that.

## Adding a new rail

Implement `PaymentRail`:

```ts
interface PaymentRail {
  readonly id: RailId;
  supports(payee: Payee): boolean;
  quote(req: PaymentRequest): Promise<RailQuote>;
  settle(req: PaymentRequest, quote: RailQuote, custody: CustodyProvider): Promise<SettlementResult>;
}
```

Then pass it in `WalletConfig.rails`. The policy engine, ledger, mandates and
approval queue all work without changes.

## Custody

| Provider | Key location | Use when |
|---|---|---|
| `LocalCustody` | In the daemon's process (viem keypair, encrypted at rest with a passphrase) | Dev, self-custody on a trusted host |
| `ManagedCustody` | Coinbase CDP server wallets — the key never enters this process | Production / stronger isolation |

Switch with `AGENT_WALLET_CUSTODY=managed` plus the `CDP_*` env vars. The rail
asks custody for an account address and an EIP-712 signature; it never sees
the key either way.
