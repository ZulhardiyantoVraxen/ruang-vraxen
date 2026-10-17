/**
 * Deterministic per-agent appearance, derived from the agent's id so it
 * stays stable across reloads without needing to store it anywhere.
 * Adapted (MIT) from yugienugraha/ruang's agents.ts.
 */

export interface AgentLook {
  hair: string;
  skin: string;
  shirt: string;
  pants: string;
}

const HAIR = ["#1d293c", "#b54b45", "#6a4d8d", "#3b2a20", "#c9a24a", "#2f4f3a", "#8b5a2b", "#11151c"];
const SKIN = ["#e9b57d", "#c98e5a", "#f1c9a0", "#a8714a", "#dca06e"];
const SHIRT = ["#e6b34e", "#70bdcb", "#93ca67", "#e76f51", "#8f7ae6", "#f4a3b4", "#4f9c7a", "#d9534f", "#5a8dee", "#c7a17a"];
const PANTS = ["#36475d", "#374052", "#344349", "#4a3b2f", "#2f3a44", "#3d2f4a"];

/** A small stable hash (FNV-1a) so an agent keeps the same look everywhere. */
export function hashName(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function agentLook(id: string): AgentLook {
  const hash = hashName(id);
  return {
    hair: HAIR[hash % HAIR.length],
    skin: SKIN[(hash >>> 4) % SKIN.length],
    shirt: SHIRT[(hash >>> 8) % SHIRT.length],
    pants: PANTS[(hash >>> 12) % PANTS.length],
  };
}
