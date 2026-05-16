/** Base error for all wallet-originated failures. */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by skeleton stubs that are not yet wired to a real backend. */
export class NotImplementedError extends WalletError {
  constructor(what: string) {
    super(`not implemented yet: ${what}`);
  }
}

/** Thrown when a payment is rejected by policy. */
export class PolicyDenied extends WalletError {
  constructor(reason: string) {
    super(`payment denied by policy: ${reason}`);
  }
}
