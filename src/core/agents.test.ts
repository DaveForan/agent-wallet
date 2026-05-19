import assert from "node:assert/strict";
import { test } from "node:test";
import type { CustodyProvider } from "../custody/custody.ts";
import { hashToken, InMemoryAgentStore } from "./agents.ts";
import { WalletDaemon } from "./wallet.ts";

const custody: CustodyProvider = {
  kind: "local",
  account: () => Promise.reject(new Error("unused")),
  authorize: () => Promise.reject(new Error("unused")),
};

test("hashToken is deterministic and does not reveal the token", () => {
  const hash = hashToken("awk_secret-token");
  assert.equal(hash, hashToken("awk_secret-token"));
  assert.notEqual(hash, "awk_secret-token");
  assert.equal(hash.length, 64);
});

test("an agent store puts, gets and lists agents", () => {
  const store = new InMemoryAgentStore();
  store.put({ id: "a1", tokenHash: "h1", createdAt: "2026-01-01T00:00:00Z" });
  store.put({
    id: "a2",
    tokenHash: "h2",
    label: "shopper",
    createdAt: "2026-01-02T00:00:00Z",
  });
  assert.equal(store.get("a1")?.id, "a1");
  assert.equal(store.list().length, 2);
});

test("an agent store resolves an agent by token hash", () => {
  const store = new InMemoryAgentStore();
  store.put({ id: "a1", tokenHash: "h1", createdAt: "2026-01-01T00:00:00Z" });
  assert.equal(store.findByTokenHash("h1")?.id, "a1");
  assert.equal(store.findByTokenHash("unknown"), undefined);
});

test("a revoked agent is gone from the store", () => {
  const store = new InMemoryAgentStore();
  store.put({ id: "a1", tokenHash: "h1", createdAt: "2026-01-01T00:00:00Z" });
  assert.equal(store.remove("a1"), true);
  assert.equal(store.remove("a1"), false);
  assert.equal(store.get("a1"), undefined);
});

test("registering an agent and authenticating its token round-trips", () => {
  const wallet = new WalletDaemon({
    policy: { mode: "autonomous" },
    rails: [],
    custody,
  });
  assert.equal(wallet.hasAgents(), false);

  const registered = wallet.registerAgent("research-agent", "Research");
  assert.match(registered.token, /^awk_/);
  assert.equal(wallet.hasAgents(), true);
  assert.equal(wallet.authenticateAgent(registered.token), "research-agent");
  assert.equal(wallet.authenticateAgent("awk_wrong"), undefined);

  assert.equal(wallet.revokeAgent("research-agent"), true);
  assert.equal(wallet.authenticateAgent(registered.token), undefined);
  assert.equal(wallet.hasAgents(), false);
});
