---
layout: home

hero:
  name: agent-wallet
  text: A wallet for AI agents
  tagline: Policy-governed payment for autonomous agents. The agent requests; the wallet decides.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Core concepts
      link: /concepts

features:
  - title: Trust boundary
    details: The agent is an untrusted caller. Every payment passes a policy engine — caps, mandates, approval, freeze — before any rail moves money.
  - title: Mandates as authority
    details: AP2-shaped grants. Cap, per-txn and per-item limits, rolling windows, categories, merchant domains, agent scoping, expiry.
  - title: Three rails
    details: x402 crypto (verified live on Base Sepolia), Stripe Issuing virtual cards, and ACP agentic checkout via Shared Payment Tokens.
  - title: Tamper-evident ledger
    details: Every audit event SHA-256-chained; optional Ed25519 signing for write-access resistance. GET /audit/verify catches edits.
  - title: Authenticated agents
    details: Per-agent bearer tokens, rate limits, attribution on every payment, mandates scopable to one agent.
  - title: Operator-first
    details: Web control plane with freeze switch, approval queue, mandate UI, agent registry, spend report per agent.
---

## What this is

**agent-wallet** is a wallet you give to an AI agent so it can pay for things
autonomously — within bounds you set, with an audit trail you can verify.

The agent is *untrusted by design*. It can *request* a payment; it cannot
*authorise* one. Authority lives in mandates the operator creates. The policy
engine evaluates every request against those mandates, with a hard limit
above everything, a freeze switch above that, and an approval queue for
spending that needs human sign-off.

## Pick a track

- **[Operators](/operator-guide)** — install, run the daemon, create mandates,
  register agents, approve payments, freeze the wallet.
- **[Agents](/agent-guide)** — the MCP tools an agent calls. `request_payment`,
  `pay_checkout`, and the agentic-checkout shopping loop.
- **[Security posture](/security)** — what's enforced and what isn't.

## At a glance

```bash
npm install
npm run daemon
claude mcp add --transport http agent-wallet http://localhost:4024/mcp
```

The daemon prints a control-plane URL with a token. Open it, create a mandate,
and the agent is in business.
