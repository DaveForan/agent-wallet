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
  The daemon serves it over Streamable HTTP at `/mcp`; a stdio transport is
  also available (`npm run mcp`) for stdio-only MCP hosts.
- **x402 interceptor** — *ambient* payments: a `fetch` wrapper that satisfies
  HTTP 402 transparently, so the agent never spends reasoning on a micro-fee.
- **Payment API** — `POST /pay` for non-MCP agents (`http-api.ts`).
- **Control API + web UI** — the operator's plane (`control-api.ts`): mandate
  CRUD, the approval queue, freeze/unfreeze, status and a spend report, with a
  self-contained web console served at `GET /` (`control-ui.ts`).
  **Operator-only** and kept separate from the agent surfaces — an agent can
  never grant itself a mandate or lift a freeze. Every endpoint but `GET /`
  requires a **bearer token** (`Authorization: Bearer` header or `?token=`).

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
npm run daemon          # run the unified wallet daemon (all surfaces)
npm test                # unit suite — policy engine, codec, concurrency, interceptor
npm run demo            # policy engine end-to-end: allow / deny / needs_approval
npm run daemon:check    # the daemon, end to end — one wallet across every surface
npm run custody:address # generate the local keypair, print the funding address
npm run x402:check      # real x402 payment on Base Sepolia (needs testnet USDC)
npm run stripe:check    # issue a test virtual card (needs a Stripe test key)
npm run control:check   # durable storage + operator control plane, end to end
npm run mcp:check       # exercise the MCP tools over a stdio transport
npm run typecheck       # strict type-check
npm run build           # emit to dist/
```

### Running the wallet daemon

`npm run daemon` starts the wallet with durable SQLite storage and serves
**every surface from one process, over one shared wallet**:

- **MCP server** (Streamable HTTP) — `http://localhost:4024/mcp`
- **agent payment API** — `POST http://localhost:4022/pay`
- **operator control plane + web UI** — `http://localhost:4023/`

A wallet is single-writer by design — the spend-cap accounting must never be
raced — so it runs in exactly one process. The agent (MCP or payment API) and
the operator (control plane) therefore drive the *same* wallet: a mandate, a
freeze and the ledger are all shared.

On startup the daemon prints a control token (set `AGENT_WALLET_CONTROL_TOKEN`
to pin your own) and a ready-to-open `…/?token=…` URL. Open it in a browser for
the operator console: the freeze kill-switch, the approval queue, mandates
(with spend bars and a create form), the spend report, and a live audit feed.
The page captures the token and carries it on every API call. State persists
in `.agent-wallet/wallet.db` across restarts.

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

### Verifying managed custody (Coinbase CDP)

`ManagedCustody` is a drop-in replacement for `LocalCustody` — the x402 rail
needs no changes. To verify it end to end:

1. Create free API keys in the [CDP Portal](https://portal.cdp.coinbase.com/)
   and export `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`.
2. `AGENT_WALLET_CUSTODY=managed npm run custody:address` — prints the CDP
   server account's address; fund it with Base Sepolia USDC (as above).
3. `AGENT_WALLET_CUSTODY=managed npm run x402:check` — the same x402 test, now
   signing through CDP. A real Base Sepolia payment confirms the CDP path.

### Verifying the Stripe rail (Issuing for agents)

`StripeRail.settle()` issues a single-use virtual card whose spend limit is
locked to the authorized amount. To verify it:

1. In a Stripe account, enable **Issuing** (test mode) and copy the test
   secret key (`sk_test_...`).
2. `STRIPE_SECRET_KEY=sk_test_... npm run stripe:check` — issues a $25 test
   virtual card and prints a Stripe dashboard link. It skips cleanly with no
   key, and refuses to run against a non-test key.

## Connecting it to Claude

Start the daemon, then point Claude at its MCP endpoint over HTTP:

```bash
npm run daemon
claude mcp add --transport http agent-wallet http://localhost:4024/mcp
```

This is the recommended path: Claude and the operator share the *one* wallet
the daemon runs.

**Stdio alternative.** For an MCP host that only speaks stdio, `npm run mcp`
(`src/mcp-main.ts`) runs an MCP server over stdio — but as a *separate,
standalone wallet*, not the daemon's. Use it only when HTTP transport is not an
option.

The agent gets three tools — `request_payment`, `get_payment_status`,
`list_mandates`. It can *request* spend and *read* state; it deliberately has
no tool to *approve* a payment, create a mandate, or lift a freeze — those
live on the operator control API, a separate surface.

## Known limitations

These are deliberate boundaries of the first scope, not bugs:

- **No cross-currency handling.** Each currency is its own scale; a mandate in
  one currency cannot authorize a payment in another. The wallet escalates
  such a payment rather than mis-comparing it — safe, but limited. There is no
  FX or normalization.
- **The ledger is append-only by convention, not cryptographically.** Nothing
  in the code mutates or deletes events, but the SQLite file is not
  hash-chained or otherwise tamper-evident. A reasonable v2 hardening.
- **`LocalCustody` holds the signing key in the daemon's process.** For
  stronger isolation use `ManagedCustody` (Coinbase CDP), where the key never
  enters this process.

## Next steps

1. End-to-end verification of the CDP and Stripe paths against real accounts
   (turnkey — see *Verifying* above).

## Protocol references

- [x402](https://www.x402.org/) — HTTP-native crypto payments
- [AP2](https://ap2-protocol.org/) — Agent Payments Protocol (mandates)
- [Stripe Issuing for agents](https://docs.stripe.com/issuing/agents)
- [Model Context Protocol](https://modelcontextprotocol.io/)
