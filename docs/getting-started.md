# Getting started

This walks you from clone to a Claude agent making its first policy-governed
payment, in about five minutes.

## Prerequisites

- **Node 22+** — the wallet uses Node's built-in SQLite and runs TypeScript
  directly without a transpile step.
- A clone of the repo:

  ```bash
  git clone <repo-url> agent-wallet
  cd agent-wallet
  npm install
  ```

## 1 — Run the daemon

```bash
npm run daemon
```

This starts one process serving every surface:

- The **agent MCP server** at `http://localhost:4024/mcp` (HTTP transport).
- The **agent payment API** at `http://localhost:4022/pay`.
- The **operator control plane** at `http://localhost:4023/` (UI + JSON API).

It prints a one-time URL like `http://localhost:4023/?token=…`. Open it in a
browser — that's the operator console.

## 2 — Create a mandate

A mandate is a grant of spending authority — the only kind of authority the
wallet recognises. In the *Mandates* card of the operator console, fill in:

- **id**: `daily-spend`
- **granted by**: your name
- **cap**: `2000` (minor units = $20.00)
- **currency**: `USD`
- **per-txn cap**: `500` ($5.00)
- **rails**: leave defaults

Hit *Create mandate*.

## 3 — Connect Claude

```bash
claude mcp add --transport http agent-wallet http://localhost:4024/mcp
```

Now Claude can see the wallet's tools — `request_payment`,
`get_payment_status`, `list_mandates`, plus the agentic-checkout tools
(`acp_create_checkout`, `pay_checkout`, …).

::: tip
The MCP and payment surfaces are **unauthenticated by default** but bound to
`127.0.0.1`. Once you register an agent in the *Agents* card, both surfaces
start requiring a per-agent token. See **[For operators](/operator-guide)**.
:::

## 4 — Ask Claude to spend

Ask Claude to pay something using the new mandate. With the default policy
(`tiered`, `autoApproveThreshold` $1.00), anything under $1 auto-settles; up
to the cap goes to your **approval queue**; above the hard limit ($50) is
flat-out denied.

You see every payment in the *Approval queue* and the *Recent audit events*
sections. Hit **Freeze** any time to stop everything.

## Verify the rails

```bash
npm run x402:check         # real Base Sepolia tx (testnet, no cost)
npm run stripe:check       # skipped without STRIPE_SECRET_KEY
npm run control:check      # control plane + durable storage end-to-end
npm run daemon:check       # one wallet across MCP, payment, control
npm test                   # the unit suite
```

`x402:check` settles a real on-chain payment using a built-in funded test
key. The Stripe and ACP paths need accounts; see **[Payment rails](/rails)**.

## Next

- **[Core concepts](/concepts)** — the trust boundary, mandates, the policy
  engine, the audit ledger.
- **[For operators](/operator-guide)** — every control you have.
- **[For agents](/agent-guide)** — every tool the agent has.
