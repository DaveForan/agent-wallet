import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkChain, InMemoryLedger } from "./ledger.ts";
import { Ed25519LedgerSigner } from "./ledger-signer.ts";

describe("Ed25519LedgerSigner", () => {
  test("signs a hash and verifies its own signature", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const hash = "a".repeat(64);
    const sig = signer.sign(hash);
    assert.equal(signer.verify(hash, sig, signer.keyId), true);
  });

  test("rejects a signature for a different hash", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const sig = signer.sign("a".repeat(64));
    assert.equal(signer.verify("b".repeat(64), sig, signer.keyId), false);
  });

  test("rejects a signature presented under the wrong key id", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const hash = "a".repeat(64);
    assert.equal(signer.verify(hash, signer.sign(hash), "not-the-key"), false);
  });

  test("a key reloaded from its PEM verifies signatures it made", () => {
    const { signer, privateKeyPem } = Ed25519LedgerSigner.generate();
    const hash = "c".repeat(64);
    const sig = signer.sign(hash);
    const reloaded = new Ed25519LedgerSigner(privateKeyPem);
    assert.equal(reloaded.verify(hash, sig, reloaded.keyId), true);
  });
});

describe("a signed ledger", () => {
  test("verifies its hash chain and signatures", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const ledger = new InMemoryLedger(signer);
    ledger.append("payment.requested", { amount: 10n });
    ledger.append("payment.settled", { amount: 10n });
    const result = ledger.verifyIntegrity();
    assert.equal(result.ok, true);
    assert.equal(result.events, 2);
  });

  test("every appended event carries a signature", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const event = new InMemoryLedger(signer).append("wallet.frozen", {});
    assert.ok(event.signature);
    assert.equal(event.keyId, signer.keyId);
  });

  test("checkChain rejects an event whose signature was stripped", () => {
    const { signer } = Ed25519LedgerSigner.generate();
    const ledger = new InMemoryLedger(signer);
    ledger.append("payment.requested", {});
    ledger.append("payment.settled", {});
    const events = ledger
      .history()
      .map((e, i) => (i === 1 ? { ...e, signature: undefined } : e));
    const result = checkChain(events, signer);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "signature missing or invalid");
  });

  test("checkChain rejects events signed by a different key", () => {
    const ledger = new InMemoryLedger(Ed25519LedgerSigner.generate().signer);
    ledger.append("payment.requested", {});
    const stranger = Ed25519LedgerSigner.generate().signer;
    const result = checkChain(ledger.history(), stranger);
    assert.equal(result.ok, false);
  });
});
