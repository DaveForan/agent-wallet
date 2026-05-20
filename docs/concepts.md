# Core concepts

A short tour of the model behind agent-wallet — the things you need to hold in
your head to use it well.

## The trust boundary

The agent is an **untrusted caller**. It can *request* a payment; it cannot
*authorise* one. Authority is held by the wallet — specifically, by the
**policy engine** running over mandates the operator created.

The MCP and payment surfaces give the agent three abilities and only three:
*request* a payment, *read* state, *list* mandates. There is no tool to
approve, to create a mandate, to lift a freeze. Those live on the separate
**operator control API**, behind an operator token.

A compromised or prompt-injected agent stays bounded by:

- the **mandate** cap, per-txn limit, per-item limit and rolling window;
- the policy engine's **hard limit** above all mandates;
- the **freeze** kill-switch above all of policy;
- the **approval queue** for any spend that didn't auto-pass.

## Mandates

A mandate is an AP2-shaped grant of authority. Every field is opt-in:

| Field | Meaning |
|---|---|
| `cap` | Lifetime ceiling |
| `perTxnCap` | Ceiling per single payment |
| `perItemCap` | Ceiling per cart line item |
| `window` | Rolling-window cap, e.g. $50 / 24 hours |
| `rails` | Which rails this mandate may use |
| `allowedPayees` | Address allowlist |
| `allowedCategories` | Category allowlist (line items for carts) |
| `blockedCategories` | Category blocklist (per line item) |
| `allowedMerchants` | Merchant id allowlist (agent-supplied — soft) |
| `allowedMerchantDomains` | Merchant ACP endpoint host allowlist — the real ACP security control |
| `agentId` | Scope the mandate to one authenticated agent |
| `expiresAt` | ISO-8601 expiry |
| `revoked` | Set true to disable |

Without a mandate, a payment either escalates to the approval queue (if
`requireMandate` is on) or is judged by autonomy mode alone.

## The policy engine

`PolicyEngine.evaluate(request, context)` returns one of three outcomes:

- **allow** — the rail is asked to settle.
- **deny** — recorded as `payment.blocked` on the audit ledger.
- **needs_approval** — added to the operator's approval queue.

It runs, in order:

1. **Hard limit** — above all mandates.
2. **Cart-total** — a cart's merchant-declared total must not exceed the
   authorised amount.
3. **Mandate** — revoked, expired, agent-scoped, rails, payees, categories,
   merchant domains, blocked categories, per-item cap, per-txn cap, lifetime
   cap, rolling window.
4. **Autonomy mode** — `autonomous` allows, `approve-every` escalates,
   `tiered` allows under `autoApproveThreshold` and escalates above.

## Autonomy mode

```ts
type PolicyMode = "autonomous" | "tiered" | "approve-every";
```

- `autonomous` — anything that passes policy auto-settles.
- `tiered` — auto-settle under `autoApproveThreshold`; escalate above.
- `approve-every` — escalate every payment.

## The audit ledger

Every decision and state change is appended — *only* appended — to a SQLite
ledger. Each event carries a **SHA-256 hash chained to the previous one**, so
edits, deletions and reorders are detectable.

With an optional **Ed25519 signing key** (`AGENT_WALLET_LEDGER_KEY`,
`npm run ledger:keygen`), each event is also signed; rewriting history then
requires the signing key, not just database access.

Operators verify the chain with `GET /audit/verify` or the *Ledger integrity*
line in the report card.

## Agents

Once the operator registers an agent (`POST /agents`), the wallet returns a
**bearer token once** — only its SHA-256 is stored. The agent presents the
token; the wallet resolves it to an `agentId` and binds that id to every
payment. The id cannot be spoofed — it comes from the verified token, never
agent input.

With one or more agents registered, the payment API and MCP-over-HTTP both
require a valid token. With none registered, the surfaces are open (loopback
only) and gated by policy alone.

## Payment rails

| Rail | What it pays | Stack |
|---|---|---|
| `x402` | HTTP resources behind 402 Payment Required | EIP-3009 stablecoin (Base Sepolia by default) |
| `stripe` | A single-use virtual card capped at the amount | Stripe Issuing |
| `acp` | An ACP merchant's checkout session | Stripe Shared Payment Token |

All three sit behind one `PaymentRail` interface. See **[Payment rails](/rails)**.

## Custody

Signing keys live behind a `CustodyProvider`:

- **LocalCustody** — viem keypair in the daemon's process. Suitable for dev
  and self-custody on a trusted host. The keystore is encrypted at rest when a
  passphrase is set.
- **ManagedCustody** — Coinbase CDP server wallets. The key never enters the
  process. Set `AGENT_WALLET_CUSTODY=managed` plus the `CDP_*` env vars.

## Operator surface vs. agent surface

| Surface | Who | Authenticated? | Capabilities |
|---|---|---|---|
| **Control API + UI** (`:4023`) | Operator | Bearer token (always) | Mandates, agents, funding source, freeze, audit, report |
| **Payment API** (`:4022`) | Agent | Per-agent token *when agents are registered* | `POST /pay` |
| **MCP** (`:4024/mcp`) | Agent | Per-agent token *when agents are registered* | `request_payment`, `pay_checkout`, etc. |

All three bind `127.0.0.1` only.
