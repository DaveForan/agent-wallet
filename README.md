# agent-wallet

A policy-governed payment wallet for autonomous agents. It lets an agent pay
for things — crypto micropayments *and* real-world purchases — **without the
agent ever being trusted with the keys, the limits, or the final yes/no.**

## The core idea: the wallet is a trust boundary

An AI agent is non-deterministic and prompt-injectable. So in agent-wallet the
agent is an *untrusted caller*. It may **request** a payment; it can never
**authorize** one. Every request flows through a policy engine that decides
`allow` / `deny` / `needs_approval`, and every decision is written to an
append-only audit ledger before any money moves.

```
agent ──request──▶ surface ──▶ WalletDaemon ──▶ PolicyEngine ──▶ decision
                                    │                               │
                                    │            ┌──────────────────┘
                                    ▼            ▼
                                 Ledger      PaymentRail ──▶ CustodyProvider
                                (audit)     (x402 / Stripe)   (keys / funds)
```

## Architecture

| Layer        | What it is                                              | Files            |
|--------------|---------------------------------------------------------|------------------|
| **Core**     | Domain types, the policy engine, the audit ledger, the daemon | `src/core/`      |
| **Rails**    | How value actually moves — pluggable                    | `src/rails/`     |
| **Custody**  | Where keys & funds live — pluggable                     | `src/custody/`   |
| **Surfaces** | How an agent or human reaches the wallet                | `src/surfaces/`  |

### Rails (`PaymentRail`)

- **x402** — the crypto rail. HTTP-402-based stablecoin payments (the
  Coinbase / Cloudflare standard).
- **Stripe** — the fiat rail. Virtual cards via Stripe "Issuing for agents",
  with real-time authorization and spend controls.

Both sit behind one `PaymentRail` interface, so the daemon and the policy
engine stay rail-agnostic.

### Custody (`CustodyProvider`)

Custody is abstracted so the decision can be deferred:

- **Managed** — keys/funds held by Coinbase CDP / a cloud KMS. No private keys
  in this process. The intended v1 default. *(stubbed)*
- **Local** — self-custody. The wallet generates its own EVM keypair and keeps
  it in an optionally-encrypted keystore. The x402 rail signs *through* this
  provider, so the rail never holds the key.

### Surfaces

- **MCP server** — *deliberate* payments: the tools an agent explicitly calls.
  Wired to `@modelcontextprotocol/sdk` over stdio (`npm run mcp`).
- **x402 interceptor** — *ambient* payments: a `fetch` wrapper that satisfies
  HTTP 402 transparently, so the agent never spends reasoning on a micro-fee.
- **HTTP API** — for non-MCP agents and the human approval UI.

### Autonomy is configuration, not code

One `PolicyConfig.mode` switch:

- `autonomous` — spend freely within a mandate.
- `tiered` — auto-approve under a threshold, escalate above it.
- `approve-every` — every payment waits for a human.

Spending authority is granted via **mandates** (modelled on Google's AP2):
lifetime caps, per-transaction limits, rolling windows, and rail / payee /
category allowlists.

## Status

Real and working: the architecture, policy engine, audit ledger, daemon, the
**MCP server surface**, **local custody**, and the **x402 rail** on Base
Sepolia. Still stubbed: the Stripe rail and managed custody.

```bash
npm install
npm run demo            # policy engine end-to-end: allow / deny / needs_approval
npm run mcp:check       # spawn the MCP server + a client, exercise the tools
npm run mcp             # run the MCP server on stdio (for an MCP host)
npm run custody:address # generate the local keypair, print the funding address
npm run x402:check      # real x402 payment on Base Sepolia (needs testnet USDC)
npm run typecheck       # strict type-check
npm run build           # emit to dist/
```

### Paying on Base Sepolia with the x402 rail

1. `npm run custody:address` — generates the wallet's EVM keypair and prints
   its address.
2. Fund that address with **Base Sepolia USDC** from a faucet
   (e.g. [faucet.circle.com](https://faucet.circle.com)). No ETH needed —
   x402 payments are gasless; the facilitator sponsors gas.
3. `npm run x402:check` — spawns a local x402-protected endpoint and pays it
   for real. On success it prints a BaseScan transaction link.

Until the address holds USDC, `x402:check` runs the whole pipeline and stops
at the facilitator with `insufficient_balance` — proof that quoting and
signing work; only on-chain settlement needs funds.

## Connecting it to Claude

The MCP server is the agent-facing surface. Point an MCP host at it:

```jsonc
{
  "mcpServers": {
    "agent-wallet": {
      "command": "node",
      "args": ["src/mcp-main.ts"],
      "cwd": "/home/dave/Projects/agent-wallet"
    }
  }
}
```

In Claude Code, from the repo root: `claude mcp add agent-wallet -- node src/mcp-main.ts`.

The agent gets three tools — `request_payment`, `get_payment_status`,
`list_mandates`. It can *request* spend and *read* state; it deliberately has
no tool to *approve* a payment — approval stays with a human on the HTTP
surface.

## Next steps

1. Wire `ManagedCustody` to Coinbase CDP server wallets.
2. Wire `StripeRail` to Stripe Issuing for agents.
3. Build the human approval UI on top of the HTTP surface.
4. Replace the in-memory `Ledger` / `MandateStore` with a durable store.

## Protocol references

- [x402](https://www.x402.org/) — HTTP-native crypto payments
- [AP2](https://ap2-protocol.org/) — Agent Payments Protocol (mandates)
- [Stripe Issuing for agents](https://docs.stripe.com/issuing/agents)
- [Model Context Protocol](https://modelcontextprotocol.io/)
