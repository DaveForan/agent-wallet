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
| **Storage**  | Durable SQLite-backed ledger, mandates, approvals, control | `src/storage/`   |
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

- **Managed** — keys held by Coinbase CDP server wallets. No private keys in
  this process; agent-wallet holds only API credentials. The intended v1
  default.
- **Local** — self-custody. The wallet generates its own EVM keypair and keeps
  it in an optionally-encrypted keystore.

The x402 rail signs *through* whichever provider is configured, so swapping
local for managed custody needs no rail changes.

### Storage (`src/storage/`)

State is durable in a single `node:sqlite` file (`.agent-wallet/wallet.db`) —
the audit ledger, mandates, pending approvals and the freeze state all survive
a restart. A wallet is a **single-writer** store by design: one process owns
the file, so the spend-cap accounting can never be raced. The in-memory stores
remain the default for tests and short-lived runs.

### Surfaces

- **MCP server** — *deliberate* payments: the tools an agent explicitly calls.
  Wired to `@modelcontextprotocol/sdk` over stdio (`npm run mcp`).
- **x402 interceptor** — *ambient* payments: a `fetch` wrapper that satisfies
  HTTP 402 transparently, so the agent never spends reasoning on a micro-fee.
- **Payment API** — `POST /pay` for non-MCP agents (`http-api.ts`).
- **Control API + web UI** — the operator's plane (`control-api.ts`): mandate
  CRUD, the approval queue, freeze/unfreeze, status and a spend report, with a
  self-contained web console served at `GET /` (`control-ui.ts`).
  **Operator-only** and kept separate from the agent surfaces — an agent can
  never grant itself a mandate or lift a freeze.

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
**MCP server surface**, durable **SQLite storage**, the **operator control
plane**, both custody providers (**local** and **managed/CDP**), and both
rails — the **x402 rail** on Base Sepolia and the **Stripe rail** on Issuing
virtual cards. The x402 rail is verified end to end with a real on-chain
payment; the CDP and Stripe paths are implemented against their SDKs and need
account credentials to exercise (see below).

```bash
npm install
npm run demo            # policy engine end-to-end: allow / deny / needs_approval
npm run control         # run the wallet daemon — opens the control UI + APIs
npm run mcp:check       # spawn the MCP server + a client, exercise the tools
npm run mcp             # run the MCP server on stdio (for an MCP host)
npm run custody:address # generate the local keypair, print the funding address
npm run x402:check      # real x402 payment on Base Sepolia (needs testnet USDC)
npm run control:check   # durable storage + operator control plane, end to end
npm run typecheck       # strict type-check
npm run build           # emit to dist/
```

### Running the wallet daemon

`npm run control` starts the wallet with durable SQLite storage and opens two
HTTP surfaces from one process:

- **operator control plane + web UI** — <http://localhost:4023/>
- **agent payment API** — `POST http://localhost:4022/pay`

Open the control URL in a browser for the operator console: the freeze
kill-switch, the approval queue, mandates (with spend bars and a create form),
the spend report, and a live audit feed. State persists in
`.agent-wallet/wallet.db` across restarts.

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

### Managed custody (Coinbase CDP)

`ManagedCustody` is a drop-in replacement for `LocalCustody` — the x402 rail
needs no changes. It reads `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` and
`CDP_WALLET_SECRET` (created free in the [CDP Portal](https://portal.cdp.coinbase.com/)),
resolves a CDP server account, and signs with the CDP-held key.

### The Stripe rail (Issuing for agents)

`StripeRail.settle()` issues a single-use virtual card whose spend limit is
locked to the authorized amount. It needs `STRIPE_SECRET_KEY` — use a
**test-mode** key (`sk_test_...`) so no real money moves — with Issuing
enabled on the account.

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
no tool to *approve* a payment, create a mandate, or lift a freeze — those
live on the operator control API, a separate surface.

## Next steps

1. Authentication on the control API before it is exposed beyond localhost.
2. Unify the process model — one daemon exposing the MCP surface alongside the
   control plane and payment API, so an MCP agent and the operator share a
   wallet.
3. End-to-end verification of the CDP and Stripe paths against real accounts.

## Protocol references

- [x402](https://www.x402.org/) — HTTP-native crypto payments
- [AP2](https://ap2-protocol.org/) — Agent Payments Protocol (mandates)
- [Stripe Issuing for agents](https://docs.stripe.com/issuing/agents)
- [Model Context Protocol](https://modelcontextprotocol.io/)
