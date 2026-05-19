import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

/**
 * Signs the audit ledger's event hashes — optional.
 *
 * A ledger with no signer is hash-chained, so casual or partial tampering is
 * detectable. But the chain is self-contained: an attacker with write access
 * who recomputes every hash can rewrite history undetectably. A signer raises
 * that bar — rewriting then also needs the signing key, which is held outside
 * the wallet database (a separate file, an env var, or a secrets manager).
 */
export interface LedgerSigner {
  /** Identifier of the signing key, recorded with each event. */
  readonly keyId: string;
  /** Sign an event hash (hex); returns a base64 signature. */
  sign(hash: string): string;
  /** Verify a signature for `hash`, produced under key `keyId`. */
  verify(hash: string, signature: string, keyId: string): boolean;
}

/** A {@link LedgerSigner} backed by an Ed25519 keypair. */
export class Ed25519LedgerSigner implements LedgerSigner {
  readonly keyId: string;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(privateKeyPem: string, keyId?: string) {
    this.privateKey = createPrivateKey(privateKeyPem);
    this.publicKey = createPublicKey(this.privateKey);
    this.keyId = keyId ?? publicKeyId(this.publicKey);
  }

  /** Generate a fresh keypair; returns the signer and its private key PEM. */
  static generate(): { signer: Ed25519LedgerSigner; privateKeyPem: string } {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    return { signer: new Ed25519LedgerSigner(pem), privateKeyPem: pem };
  }

  sign(hash: string): string {
    return cryptoSign(
      null,
      Buffer.from(hash, "hex"),
      this.privateKey,
    ).toString("base64");
  }

  verify(hash: string, signature: string, keyId: string): boolean {
    if (keyId !== this.keyId) return false;
    try {
      return cryptoVerify(
        null,
        Buffer.from(hash, "hex"),
        this.publicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {
      return false;
    }
  }
}

/** A short, stable id for a public key — the truncated SHA-256 of its DER. */
function publicKeyId(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}
