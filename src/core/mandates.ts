import type { Mandate } from "./types.ts";

/** Storage for mandates. In-memory for now; swap for a durable store later. */
export interface MandateStore {
  get(id: string): Mandate | undefined;
  put(mandate: Mandate): void;
  list(): Mandate[];
  /** Returns false if no mandate with that id exists. */
  revoke(id: string): boolean;
}

/** Development mandate store. */
export class InMemoryMandateStore implements MandateStore {
  private readonly mandates = new Map<string, Mandate>();

  get(id: string): Mandate | undefined {
    return this.mandates.get(id);
  }

  put(mandate: Mandate): void {
    this.mandates.set(mandate.id, mandate);
  }

  list(): Mandate[] {
    return [...this.mandates.values()];
  }

  revoke(id: string): boolean {
    const mandate = this.mandates.get(id);
    if (!mandate) return false;
    mandate.revoked = true;
    return true;
  }
}
