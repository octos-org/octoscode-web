/** Pinned TUI autonomy.rs parse_agents_spawn + locales/en.yml spawn_agents_turn. */
export function composeAgentSpawn(
  count: number,
  prompt: string,
): string | null {
  if (!Number.isInteger(count) || count <= 0 || count > 4_294_967_295)
    return null;
  const question = prompt.trim();
  if (!question) return null;
  return `Spawn ${count} agent(s) to accomplish in parallel: ${question}`;
}

export interface AgentSpawnHost {
  /** Must synchronously recheck captured owner, idle and ordinary queue admission. */
  onSpawnAgents?: (text: string) => boolean;
  spawnAvailable?: boolean;
}
