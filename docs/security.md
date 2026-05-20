# Security posture

What the wallet enforces, plainly.

## Bindings

The control, payment, MCP and test servers all bind **127.0.0.1**. Nothing is
exposed to the network without a deliberate config change.

## Operator vs agent authentication

| Surface | Who | Auth |
|---|---|---|
| Control API + UI (`:4023`) | Operator | Bearer token (always) |
| Payment API (`:4022`) | Agent | Per-agent token *when agents are registered* |
| MCP over HTTP (`:4024/mcp`) | Agent | Per-agent token *when agents are registered* |

The operator token is generated at startup if `AGENT_WALLET_CONTROL_TOKEN` is
unset — never open by default. The agent surfaces are open until any agent is
registered; registering an agent turns auth on.

The agent's `agentId` is bound to every payment **from the verified token**,
not from agent input — so it cannot be spoofed.

## HTTP hygiene

- Request bodies are **size-capped** (1 MB; 413 on exceed).
- The MCP endpoint rejects oversized requests by `Content-Length` before the
  transport reads anything.
- All `prepare()` SQL is parameterised — no string-built queries.
- Dynamic values rendered in the control UI are HTML-escaped before
  `innerHTML`, including in attribute positions (`esc()`).
- `JSON.parse` is used without revivers that pollute prototypes.

## Tamper-evident audit ledger

Every event is **SHA-256 hash-chained** to the previous one. The chain has a
fixed genesis hash; `GET /audit/verify` walks it and reports `ok` with the
event count, or `brokenAt` and a `reason` if any event no longer verifies.

The hash chain detects accidental corruption, partial edits, and unsophisticated
tampering — but on its own it is *self-contained*: a write-access attacker who
recomputes every hash can rewrite history undetectably.

Setting `AGENT_WALLET_LEDGER_KEY` to an Ed25519 private key (PEM file or PEM
content) turns on **signing**: each event's hash is signed; `verifyIntegrity`
also verifies signatures. Rewriting history then requires the signing key,
which is held outside the database. Generate one with `npm run ledger:keygen`.

::: tip
The key file should live somewhere the DB-tamperer can't reach — a separate
volume, a secrets manager, or different file ownership. The keygen script
writes it next to the DB by default; that's fine for development, but not for
real tamper-resistance.
:::

## Merchant domain pinning (agentic checkout)

`mandate.allowedMerchantDomains` is an exact-host allowlist for the merchant's
ACP endpoint. A prompt-injected agent that fabricates a merchant id can't
redirect a payment to a merchant it controls — the wallet rejects any cart
whose endpoint host isn't on the list.

Carts are also **verified directly with the merchant**: the wallet re-fetches
the checkout session and uses the merchant's authoritative line items and
total, discarding the agent's claim.

## SSRF guard

Outbound fetches use a guarded `fetch` that rejects:

- non-HTTP(S) schemes;
- literal private / loopback / link-local / metadata addresses (e.g.
  `http://169.254.169.254/`);
- hostnames that *resolve* into a private range (an internal name pointing at
  loopback or RFC1918).

**Residual**: a sub-millisecond DNS-rebinding window remains — closing it
needs connection-time IP pinning, which empirically does not compose with
Node's global `fetch` and the x402 SDK (separate undici copies).

## Per-agent rate limit

A sliding-window limit (default 60 payments/minute per agent;
`AGENT_WALLET_RATE_LIMIT_PER_MIN` overrides). An authenticated agent that
exceeds it is denied with `rate limit exceeded for agent "…"`.

## Approval expiry

Pending approvals auto-expire after `AGENT_WALLET_APPROVAL_TIMEOUT_HOURS`
(default 24). Expired approvals are recorded as `approval.expired` plus
`payment.blocked` on the audit ledger.

## Concurrency

`pay()` decides-and-settles under a **per-mandate lock**, so two concurrent
payments against one mandate cannot race the cap. SQLite is the single
writer; the per-mandate lock handles same-process async interleaving.

## Known limitations

- **No cross-currency handling.** Each currency is its own scale; a mandate in
  one currency cannot authorise a payment in another. Real FX needs a rate
  source (a provider choice).
- **`LocalCustody` keeps the signing key in the daemon's process.** For
  stronger isolation, use `ManagedCustody` (CDP) — the key never enters this
  process.
- **Per-line-item categories depend on the merchant.** Category and
  blocked-category rules only bind items the merchant labels; merchant-level
  scoping (`allowedMerchants` / `allowedMerchantDomains`) always applies.
- **The ACP rail is not live-verified.** Running it end to end needs Stripe
  SPT program access and a real ACP merchant.

## Want to check the posture yourself

```bash
npm test                # 121 unit tests (policy, codec, ACP, SSRF, hash chain, signing, agent auth, rate limit, expiry…)
npm run control:check   # 32 control-plane and durability checks
npm run daemon:check    # 10 cross-surface checks incl. agent-auth enforcement
npm run x402:check      # real Base Sepolia tx
npm audit               # zero vulnerabilities
```
