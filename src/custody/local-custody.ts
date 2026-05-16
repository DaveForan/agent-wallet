import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { NotImplementedError, WalletError } from "../core/errors.ts";
import type { RailId } from "../core/types.ts";
import type {
  Authorization,
  CustodyProvider,
  SigningRequest,
} from "./custody.ts";

/** Default keystore location, relative to the process working directory. */
const DEFAULT_KEYSTORE_PATH = ".agent-wallet/evm-keystore.json";
const KEYSTORE_VERSION = 1;

export interface LocalCustodyOptions {
  /** Path to the keystore file. Defaults to `.agent-wallet/evm-keystore.json`. */
  keystorePath?: string;
  /**
   * Passphrase used to encrypt/decrypt the keystore. When omitted, falls back
   * to `AGENT_WALLET_KEYSTORE_PASSPHRASE`. When neither is set the key is
   * stored in plaintext — acceptable for a throwaway testnet key only, and the
   * custody provider logs a warning when it does so.
   */
  passphrase?: string;
}

/** On-disk keystore shapes. A discriminated union on `encrypted`. */
interface KeystoreCommon {
  version: number;
  /** The EVM address, kept in clear text so it is readable without the key. */
  address: string;
}
interface PlainKeystore extends KeystoreCommon {
  encrypted: false;
  privateKey: string;
}
interface EncryptedKeystore extends KeystoreCommon {
  encrypted: true;
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}
type Keystore = PlainKeystore | EncryptedKeystore;

/**
 * Self-custody — the wallet holds its own EVM private key locally.
 *
 * On first use the key is generated and written to a keystore file
 * (`.agent-wallet/evm-keystore.json` by default, which is gitignored). The key
 * is AES-256-GCM encrypted under a scrypt-derived passphrase when one is
 * configured; otherwise it is stored in plaintext with a logged warning, which
 * is acceptable only for a disposable testnet key.
 *
 * One secp256k1 key serves every EVM network, so this backs the `x402` rail
 * on Base Sepolia and Base mainnet alike. The Stripe rail is not key-based and
 * is not served here.
 */
export class LocalCustody implements CustodyProvider {
  readonly kind = "local" as const;

  private readonly keystorePath: string;
  private readonly passphrase: string | undefined;
  /** Memoised account, populated by `ensureLoaded()`. */
  private loaded: PrivateKeyAccount | undefined;

  constructor(opts: LocalCustodyOptions = {}) {
    this.keystorePath = resolve(opts.keystorePath ?? DEFAULT_KEYSTORE_PATH);
    this.passphrase =
      opts.passphrase ?? process.env["AGENT_WALLET_KEYSTORE_PASSPHRASE"];
  }

  /** The EVM address funds must be sent to. Generates the key on first call. */
  async account(rail: RailId): Promise<string> {
    if (rail !== "x402") {
      throw new NotImplementedError(
        `local custody backs the x402 (EVM) rail; the "${rail}" rail is not ` +
          `key-based — use managed custody`,
      );
    }
    return (await this.ensureLoaded()).address;
  }

  /**
   * The viem account, for rails that need to drive signing themselves (the
   * x402 SDK's payment scheme owns the EIP-3009 signing step).
   */
  async evmAccount(): Promise<PrivateKeyAccount> {
    return this.ensureLoaded();
  }

  /** Sign an EIP-712 typed-data payload (e.g. an EIP-3009 authorization). */
  async authorize(request: SigningRequest): Promise<Authorization> {
    if (request.rail !== "x402") {
      throw new NotImplementedError(
        `local custody cannot authorize for the "${request.rail}" rail`,
      );
    }
    const payload = request.payload as { kind?: string; typedData?: unknown };
    if (payload?.kind !== "eip712" || payload.typedData === undefined) {
      throw new WalletError(
        'local custody: x402 signing expects { kind: "eip712", typedData }',
      );
    }
    const account = await this.ensureLoaded();
    // viem validates the typed-data shape at call time.
    const signature = await account.signTypedData(
      payload.typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
    return { signature };
  }

  /** Load the key from the keystore, generating and persisting it if absent. */
  private async ensureLoaded(): Promise<PrivateKeyAccount> {
    if (this.loaded) return this.loaded;

    const privateKey = existsSync(this.keystorePath)
      ? this.readKeystore()
      : this.createKeystore();

    this.loaded = privateKeyToAccount(privateKey);
    return this.loaded;
  }

  /** Generate a fresh key, persist it, and announce the funding address. */
  private createKeystore(): Hex {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const keystore = this.passphrase
      ? this.encrypt(privateKey, account.address, this.passphrase)
      : this.plaintext(privateKey, account.address);

    mkdirSync(dirname(this.keystorePath), { recursive: true });
    writeFileSync(this.keystorePath, JSON.stringify(keystore, null, 2));
    chmodSync(this.keystorePath, 0o600);

    console.error(`[custody] generated a new EVM key at ${this.keystorePath}`);
    console.error(`[custody] funding address: ${account.address}`);
    if (!this.passphrase) {
      console.error(
        "[custody] WARNING: keystore is UNENCRYPTED — set " +
          "AGENT_WALLET_KEYSTORE_PASSPHRASE; acceptable for testnet keys only",
      );
    }
    return privateKey;
  }

  /** Read and decrypt (if needed) an existing keystore. */
  private readKeystore(): Hex {
    const keystore = JSON.parse(
      readFileSync(this.keystorePath, "utf8"),
    ) as Keystore;

    let privateKey: string;
    if (keystore.encrypted) {
      if (!this.passphrase) {
        throw new WalletError(
          `keystore ${this.keystorePath} is encrypted but no passphrase was ` +
            `provided (set AGENT_WALLET_KEYSTORE_PASSPHRASE)`,
        );
      }
      privateKey = this.decrypt(keystore, this.passphrase);
    } else {
      privateKey = keystore.privateKey;
    }

    // Defend against a corrupted or tampered file.
    const derived = privateKeyToAccount(privateKey as Hex).address;
    if (derived.toLowerCase() !== keystore.address.toLowerCase()) {
      throw new WalletError(
        `keystore ${this.keystorePath} is corrupt: the key does not derive ` +
          `its recorded address`,
      );
    }
    return privateKey as Hex;
  }

  private plaintext(privateKey: Hex, address: string): PlainKeystore {
    return { version: KEYSTORE_VERSION, encrypted: false, address, privateKey };
  }

  private encrypt(
    privateKey: Hex,
    address: string,
    passphrase: string,
  ): EncryptedKeystore {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(privateKey, "utf8"),
      cipher.final(),
    ]);
    return {
      version: KEYSTORE_VERSION,
      encrypted: true,
      address,
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private decrypt(keystore: EncryptedKeystore, passphrase: string): string {
    const key = scryptSync(passphrase, Buffer.from(keystore.salt, "base64"), 32);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(keystore.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(keystore.authTag, "base64"));
    try {
      return (
        decipher.update(Buffer.from(keystore.ciphertext, "base64")).toString(
          "utf8",
        ) + decipher.final("utf8")
      );
    } catch {
      throw new WalletError(
        `failed to decrypt ${this.keystorePath}: wrong passphrase or the ` +
          `file has been tampered with`,
      );
    }
  }
}
