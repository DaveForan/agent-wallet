# API reference

Three surfaces. All bind `127.0.0.1`.

| Surface | Default port | Auth |
|---|---|---|
| Operator control API | `4023` | Operator bearer token |
| Agent payment API | `4022` | Per-agent token *if any agent is registered* |
| Agent MCP server | `4024/mcp` | Per-agent token *if any agent is registered* |

## Control API (`:4023`)

Authentication: `Authorization: Bearer <token>` header, **or** `?token=<token>`
query parameter (constant-time compared). Every route except `GET /` requires it.

### Status, audit and reporting

| Method | Path | Returns |
|---|---|---|
| `GET` | `/` | The control-plane web UI |
| `GET` | `/status` | Freeze state, queue sizes |
| `GET` | `/report` | Spend report (counters, totals per currency, mandates, orders, per-agent breakdown) |
| `GET` | `/audit` | The whole audit ledger |
| `GET` | `/audit?paymentId=…` | One payment's trail |
| `GET` | `/audit/verify` | `{ ok, events, brokenAt?, reason? }` |

### Freeze

| Method | Path | Body | Effect |
|---|---|---|---|
| `POST` | `/freeze` | `{ "reason": "..." }` | Freeze the wallet |
| `POST` | `/unfreeze` | — | Lift the freeze |

### Mandates

| Method | Path | Body |
|---|---|---|
| `GET` | `/mandates` | — |
| `POST` | `/mandates` | Mandate JSON (see below) |
| `GET` | `/mandates/:id` | — |
| `POST` | `/mandates/:id/revoke` | — |

A mandate body:

```jsonc
{
  "id": "groceries",
  "grantedBy": "operator",
  "cap": { "amount": "15000", "currency": "USD" },
  "perTxnCap": { "amount": "8000", "currency": "USD" },
  "perItemCap": { "amount": "2000", "currency": "USD" },
  "window": { "cap": { "amount": "50000", "currency": "USD" }, "durationMs": 604800000 },
  "rails": ["acp"],
  "allowedPayees": ["..."],
  "allowedCategories": ["groceries"],
  "blockedCategories": ["alcohol"],
  "allowedMerchants": ["grocer-1"],
  "allowedMerchantDomains": ["shop.realgrocer.com"],
  "agentId": "shopping-agent",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

Money amounts are integer minor units as strings — `"15000"` = `$150.00`.

### Approvals

| Method | Path | Body | Effect |
|---|---|---|---|
| `GET` | `/approvals` | — | List pending approvals |
| `POST` | `/approvals/:id/resolve` | `{ "approved": true \| false }` | Approve or reject |

### Funding source

| Method | Path | Body |
|---|---|---|
| `GET` | `/funding-source` | — |
| `POST` | `/funding-source` | `{ "paymentMethodId": "pm_…", "brand": "...", "last4": "...", "label": "..." }` |
| `DELETE` | `/funding-source` | — |

The GET view never echoes the raw `paymentMethodId`.

### Agents

| Method | Path | Body |
|---|---|---|
| `GET` | `/agents` | — |
| `POST` | `/agents` | `{ "id": "...", "label": "..." }` — returns the bearer token once |
| `DELETE` | `/agents/:id` | — |

## Payment API (`:4022`)

| Method | Path | Body |
|---|---|---|
| `POST` | `/pay` | A `PaymentInput` |

If agents are registered, an `Authorization: Bearer <agent-token>` header is
required; the resolved `agentId` is bound to the payment. `agentId` cannot be
set from the body.

```jsonc
{
  "rail": "x402",
  "amount": { "amount": "500", "currency": "USD" },
  "payee": { "address": "https://api.example.com", "label": "Example", "category": "..." },
  "memo": "...",
  "mandateId": "..."
}
```

Returns a `PayResult` — one of:

```jsonc
{ "status": "settled",          "paymentId": "...", "settlement": {...} }
{ "status": "denied",           "paymentId": "...", "reason": "..." }
{ "status": "failed",           "paymentId": "...", "reason": "..." }
{ "status": "pending_approval", "paymentId": "...", "approvalId": "...", "reason": "..." }
```

## MCP server (`:4024/mcp`)

Streamable HTTP transport — stateless, one server-and-transport per request,
sharing the one wallet. Same agent-token rule as the payment API.

### Tools

- `request_payment(rail, amount, currency, payeeAddress, payeeLabel?, memo?, mandateId?)`
- `get_payment_status(paymentId)`
- `list_mandates()`
- `acp_create_checkout(merchantEndpoint, currency, items, buyerEmail?)`
- `acp_update_checkout(merchantEndpoint, sessionId, items)`
- `acp_checkout_status(merchantEndpoint, sessionId)`
- `pay_checkout(merchantEndpoint, merchantId, sessionId, maxAmount, currency, merchantName?, mandateId?, memo?)`

See **[For agents](/agent-guide)** and **[Agentic checkout](/agentic-checkout)**
for inputs / outputs.

## Ledger event types

Every event the wallet appends. The full vocabulary:

```
payment.requested  policy.decided  payment.blocked
payment.settled    payment.failed
approval.requested approval.resolved approval.expired
mandate.created    mandate.revoked
wallet.frozen      wallet.unfrozen
funding.registered funding.cleared
agent.registered   agent.revoked
```

Each event carries `seq`, `at`, `type`, `paymentId?`, `data`, and the
tamper-evidence fields `hash` (+ `signature` / `keyId` when signing is on).
