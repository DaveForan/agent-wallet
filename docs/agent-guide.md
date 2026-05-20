# For agents

The MCP tools an agent can call, and the contract behind each.

## Connecting

The wallet exposes MCP over Streamable HTTP at `/mcp`. With Claude:

```bash
claude mcp add --transport http agent-wallet http://localhost:4024/mcp
```

If agents are registered, set an `Authorization: Bearer <token>` header on the
MCP requests (Claude does this if the MCP server is configured with the token).
The wallet binds 127.0.0.1 — there is no remote-network exposure to worry about.

For a host that only speaks stdio, `npm run mcp` runs an MCP server over stdio
— but as a *separate, standalone wallet*, not the daemon's. Use it only when
HTTP transport is not an option.

## What the agent can and can't do

| Can | Cannot |
|---|---|
| Request a payment | Approve a payment |
| Read its own payment status | Create or revoke a mandate |
| List mandates | Lift a freeze |
| Build a checkout cart with an ACP merchant | Add a funding source |
| Pay a verified checkout | Register or revoke an agent |

Those *cannot* abilities live on the operator control API, behind an operator
token. The agent cannot reach them.

## Tools

### `request_payment`

Request a payment. The wallet's policy engine decides.

**Args**

| Name | Type | Notes |
|---|---|---|
| `rail` | `"x402" \| "stripe" \| "acp"` | Required |
| `amount` | string (integer minor units) | e.g. `"500"` = $5.00 |
| `currency` | string | e.g. `"USD"` or `"USDC"` |
| `payeeAddress` | string | Rail-specific destination |
| `payeeLabel` | string | Optional human label |
| `memo` | string | Optional — recorded; never trusted |
| `mandateId` | string | Optional — the mandate to draw against |

**Result**

```jsonc
{
  "summary": "settled $5.00 USD via x402",
  "result": {
    "status": "settled" | "denied" | "failed" | "pending_approval",
    "paymentId": "...",
    // settled:
    "settlement": { "reference": "...", "settledAmount": {...}, "order": {...} },
    // denied / failed:
    "reason": "...",
    // pending_approval:
    "approvalId": "..."
  }
}
```

The agent **cannot** override a denial; a denial's `reason` tells it why so it
can adjust (a smaller amount, a different mandate, a different payee).

### `get_payment_status`

Fetch the audit trail for a payment.

**Args**: `paymentId` — the id `request_payment` returned.

**Result**: an array of `LedgerEvent`s — every state change the payment went
through (`payment.requested` → `policy.decided` → `payment.settled` /
`payment.blocked` / `approval.requested` → `approval.resolved` /
`approval.expired`).

### `list_mandates`

Returns every mandate currently registered, so the agent can pick one to draw
against. The agent doesn't know which mandate is "best"; that's the operator's
design.

### Agentic-checkout tools

See **[Agentic checkout](/agentic-checkout)** for the full flow.

- `acp_create_checkout(merchantEndpoint, currency, items, buyerEmail?)`
- `acp_update_checkout(merchantEndpoint, sessionId, items)`
- `acp_checkout_status(merchantEndpoint, sessionId)`
- `pay_checkout(merchantEndpoint, merchantId, sessionId, maxAmount, currency, …)`

## Outcomes the agent should expect

A `request_payment` returns one of four statuses; each is the start of a
different agent behaviour:

- **`settled`** — money moved; carry on.
- **`pending_approval`** — a human will decide later. Don't poll tightly;
  check status later or move on to other work. Approvals auto-expire after a
  configurable timeout.
- **`denied`** — the policy engine refused. The `reason` is human-readable;
  surface it to your user.
- **`failed`** — the rail failed (network, insufficient funds, merchant
  rejected). Treat as transient; the operator's audit shows what happened.

## What the agent should put on `memo`

Anything that helps the operator understand the payment in the approval queue.
The wallet **never trusts** the memo for any decision — it's purely for
attribution. Be honest; if the agent lies, the audit trail tells the truth
either way.

## Rate limits and identity

Once the operator registers an agent, every payment is bound to a verified
`agentId`. The agent can call up to *N* payments per minute (default 60);
exceeding it returns a `denied` with the reason `rate limit exceeded for
agent "…"`.

The agent never sees the agentId in its own tool args — it comes from the
bearer token and cannot be spoofed.
