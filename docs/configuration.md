# Configuration

Everything you can set, and every script you can run.

## Environment variables

### Daemon

| Variable | Default | Effect |
|---|---|---|
| `AGENT_WALLET_DB` | `.agent-wallet/wallet.db` | SQLite path. `:memory:` for an ephemeral wallet. |
| `AGENT_WALLET_CONTROL_PORT` | `4023` | Control plane port |
| `AGENT_WALLET_PAY_PORT` | `4022` | Payment API port |
| `AGENT_WALLET_MCP_PORT` | `4024` | MCP server port |
| `AGENT_WALLET_CONTROL_TOKEN` | *generated at startup* | Operator bearer token |

### Ledger signing

| Variable | Default | Effect |
|---|---|---|
| `AGENT_WALLET_LEDGER_KEY` | *unset* | Path to an Ed25519 PEM (or the PEM itself). When set, every audit event is signed. Generate one with `npm run ledger:keygen`. |

### Per-agent rate limit

| Variable | Default | Effect |
|---|---|---|
| `AGENT_WALLET_RATE_LIMIT_PER_MIN` | `60` | Max payments per minute per authenticated agent. `0` disables. |

### Approval expiry

| Variable | Default | Effect |
|---|---|---|
| `AGENT_WALLET_APPROVAL_TIMEOUT_HOURS` | `24` | Auto-expire pending approvals after this many hours. `0` disables. |

### Custody

| Variable | Default | Effect |
|---|---|---|
| `AGENT_WALLET_CUSTODY` | `local` | `managed` selects Coinbase CDP server wallets |
| `CDP_API_KEY_ID` | — | CDP API key id (managed custody) |
| `CDP_API_KEY_SECRET` | — | CDP API key secret |
| `CDP_WALLET_SECRET` | — | CDP wallet secret |

### Stripe

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_SECRET_KEY` | — | Stripe API key. `sk_test_…` for test mode; the smoke test refuses anything else. |

## Wallet config (TypeScript)

If you embed the `WalletDaemon` directly rather than running the bundled
daemon, the config is:

```ts
interface WalletConfig {
  policy: PolicyConfig;                 // mode, threshold, hard limit, requireMandate
  rails: PaymentRail[];                 // x402, Stripe, ACP, or your own
  custody: CustodyProvider;             // Local or Managed

  ledger?: Ledger;                      // defaults to InMemoryLedger
  mandates?: MandateStore;              // defaults to in-memory
  approvals?: ApprovalStore;            // defaults to in-memory
  control?: ControlState;               // freeze state — defaults to in-memory
  funding?: FundingSourceStore;         // defaults to in-memory
  agents?: AgentStore;                  // defaults to in-memory

  cartVerifier?: CartVerifier;          // typically an AcpClient
  rateLimit?: { count: number; windowMs: number };
  approvalTimeoutMs?: number;
}
```

The daemon (`src/daemon.ts`) is the canonical assembly: SQLite-backed stores,
LocalCustody, all three rails, an AcpClient, the env-driven knobs above.

## Policy config

```ts
interface PolicyConfig {
  mode: "autonomous" | "tiered" | "approve-every";
  autoApproveThreshold?: Money;  // for tiered
  hardLimit?: Money;             // above all mandates
  requireMandate?: boolean;      // escalate a no-mandate request
}
```

The daemon's default is:

```ts
{
  mode: "tiered",
  autoApproveThreshold: money(100, "USD"),   // $1.00 auto-approves
  hardLimit: money(5000, "USD"),             // $50.00 hard ceiling
  requireMandate: true,
}
```

## npm scripts

### Run

| Script | What it does |
|---|---|
| `npm run daemon` | The unified daemon — all surfaces, SQLite, the works |
| `npm start` | Alias for `npm run daemon` |
| `npm run dev` | The daemon under `node --watch` |
| `npm run demo` | A scripted policy-engine demo |
| `npm run mcp` | A stand-alone stdio MCP server (separate wallet) |

### Verify

| Script | What it does |
|---|---|
| `npm test` | The unit suite (`src/**/*.test.ts`) |
| `npm run typecheck` | Strict `tsc --noEmit` |
| `npm run build` | Emit `dist/` |
| `npm run mcp:check` | MCP smoke test |
| `npm run control:check` | Control plane + durable storage |
| `npm run daemon:check` | Cross-surface, including agent-auth enforcement |
| `npm run x402:check` | Real Base Sepolia tx (no cost; testnet) |
| `npm run stripe:check` | Issue a test virtual card (needs a key; skips cleanly without) |

### Setup

| Script | What it does |
|---|---|
| `npm run custody:address` | Generate a local custody keypair and print the address |
| `npm run ledger:keygen` | Generate an Ed25519 ledger signing key |
| `npm run x402:resource` | A local x402 test resource server (used by `x402:check`) |

### Docs

| Script | What it does |
|---|---|
| `npm run docs:dev` | Local dev server for this site |
| `npm run docs:build` | Build the static site to `docs/.vitepress/dist` |
