import { createHash } from "node:crypto";

/**
 * A registered agent identity. The wallet stores only the *hash* of an
 * agent's bearer token — never the token itself — so the registry leaking
 * does not leak credentials.
 */
export interface Agent {
  /** Stable, operator-chosen identifier. */
  id: string;
  /** SHA-256 (hex) of the agent's bearer token. */
  tokenHash: string;
  /** Human-readable label. */
  label?: string;
  /** ISO-8601 registration timestamp. */
  createdAt: string;
}

/** Storage for the wallet's registered agents. */
export interface AgentStore {
  put(agent: Agent): void;
  get(id: string): Agent | undefined;
  list(): Agent[];
  remove(id: string): boolean;
  /** Resolve an agent by the hash of a presented token. */
  findByTokenHash(tokenHash: string): Agent | undefined;
}

/** The SHA-256 (hex) of a token — what the registry stores, never the token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Development agent store. Lost on restart. */
export class InMemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, Agent>();

  put(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  remove(id: string): boolean {
    return this.agents.delete(id);
  }

  findByTokenHash(tokenHash: string): Agent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.tokenHash === tokenHash) return agent;
    }
    return undefined;
  }
}
