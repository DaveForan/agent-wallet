# For operators

Everything you can do as the human running the wallet.

## Starting the daemon

```bash
npm run daemon
```

The daemon prints a control-plane URL with a one-time token, e.g.

```
agent-wallet daemon ready — one wallet, every surface
  control plane URL: http://localhost:4023/?token=...
  agent payment API: http://localhost:4022/pay
  agent MCP server:  http://localhost:4024/mcp
ledger signing: off — hash-chained only
```

Open the URL. The token is captured into session storage and stripped from the
address bar; the UI carries it on every API call.

To pin a token across restarts, set `AGENT_WALLET_CONTROL_TOKEN`. To survive a
restart with the same database, set `AGENT_WALLET_DB`. See
**[Configuration](/configuration)** for every env var.

## Creating mandates

The *Mandates* card in the UI exposes every field. By concern:

**Spending limits**

- *cap* — lifetime ceiling, in minor units (e.g. `2000` = $20.00).
- *per-txn cap* — ceiling per single payment.
- *per-item cap* — ceiling per cart line item (agentic checkout).

**Where the money may go**

- *rails* — `x402`, `stripe`, `acp` checkboxes.
- *allowed payees* — comma-separated address allowlist.

**Categories**

- *allowed categories* — whitelist; with a cart, *every* line item must be in
  it.
- *blocked categories* — blacklist; any line item in it denies the payment.

**Merchants (for agentic checkout)**

- *allowed merchant ids* — soft allowlist (the merchant id is agent-supplied).
- *allowed merchant domains* — **the real ACP security control**. The host of
  the merchant's ACP endpoint must match exactly. Without this set, an
  agent-controlled endpoint could pass policy.

**Scope and lifecycle**

- *agent* — restrict the mandate to one authenticated agent (the `agentId`).
- *expires* — ISO-8601 datetime.

A mandate can also be created via `POST /mandates` with the same fields — see
the **[API reference](/api-reference)**.

## Approving payments

A payment that escalates lands in the *Approval queue*. The card shows the
amount, payee, memo, the cart (for ACP payments), and the policy's reason for
escalating. **Approve** triggers settlement; **Reject** denies it.

Pending approvals **auto-expire** after `AGENT_WALLET_APPROVAL_TIMEOUT_HOURS`
(default 24); the queue self-cleans rather than accumulating.

## Registering agents

The *Agents* card. Fill in an id and an optional label, click *Register agent* —
the daemon generates a token and shows it **once**. Copy it. The wallet stores
only its SHA-256.

Once at least one agent is registered, the payment API and MCP-over-HTTP both
require a valid bearer token. With none registered, the surfaces are open
(loopback only) and gated by policy alone.

**Revoke** invalidates the token immediately.

## Funding source (for agentic checkout)

The *Funding source* card holds the Stripe payment method (`pm_…`) that ACP
Shared Payment Tokens are minted against. The view never echoes the raw
payment-method id back — only the brand, last four and label.

See **[Agentic checkout](/agentic-checkout)** for the full flow.

## Freezing the wallet

The freeze banner has *Freeze* and *Unfreeze* buttons. While frozen, every
payment is denied with `wallet is frozen: <reason>`. Freezing takes precedence
over every other rule, including auto-approvals already pending.

The freeze state is **durable** — it survives a restart.

## The audit ledger

The *Recent audit events* card streams the last 25 events. `GET /audit` returns
the whole ledger; `GET /audit?paymentId=…` returns one payment's trail.

The audit ledger is **hash-chained**: tampering with any row is detected by
`GET /audit/verify`, which the *Ledger integrity* stat reflects. Set
`AGENT_WALLET_LEDGER_KEY` (see `npm run ledger:keygen`) to also **sign** every
event, so rewriting history needs the key as well as DB access.

## The spend report

The *Spend report* card carries:

- counters: settled / failed / denied / blocked-by-freeze.
- totals settled per currency.
- merchant orders (for reconciliation against the merchant).
- **per-agent breakdown**: settled count, settled per currency, denied, pending.
- ledger integrity.

`GET /report` returns the same data as JSON.

## Common scenarios

### "Groceries at allowlisted stores, no alcohol, anything over $80 needs my OK"

A `tiered`-mode policy with `autoApproveThreshold: 8000` ($80). Create a
mandate:

- `cap: 15000` ($150), `currency: USD`
- `allowedMerchantDomains: shop.realgrocer.com`
- `blockedCategories: alcohol`
- `rails: acp`

### "Let only the research agent use this mandate"

Register the agent (note its id). On the mandate, set *agent* to that id. Any
other agent presenting the mandate is denied.

### "Quick freeze and shut everything down"

Click *Freeze* in the banner. Done. To resume, *Unfreeze*.
