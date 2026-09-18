import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import type { PeerGatherResult } from "@octos-org/octoscode-client/peers";
import type { ActiveSessionAuthority } from "../session/active-session-runtime.ts";
import type { SessionRecord } from "../session/session-record-manager.ts";
import type { ReasoningEffort } from "../reasoning/model.ts";

export type GatherOutcome = "queued" | "empty" | "blocked" | "stale" | "failed";
const MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const note = "\n[…result truncated to fit the gather prompt cap]";

/** Pinned TUI store.rs compose_gather_prompt: equal UTF-8 result budgets. */
export function composeGatherPrompt(result: PeerGatherResult): string {
  const build = (budget?: number) => {
    let output = "Peer results gathered from the blackboard:\n";
    for (const peer of result.peers) {
      output += `\n## peer ${peer.slug} (${peer.result !== null ? "done" : "no result yet"})\nBrief: ${[...peer.brief].slice(0, 200).join("")}\n\n`;
      if (peer.result === null) {
        output += "(still running — no result file yet)\n";
        continue;
      }
      const bytes = encoder.encode(peer.result);
      if (budget !== undefined && bytes.length > budget) {
        let end = budget;
        while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
        output +=
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            bytes.subarray(0, end),
          ) + note;
      } else output += peer.result;
      output += "\n";
    }
    return output;
  };
  const full = build();
  if (encoder.encode(full).length <= MAX_BYTES) return full;
  const overhead = encoder.encode(build(0)).length;
  // An unbounded Profile fleet can exceed the TUI's assumed small scaffolding.
  // Refuse it rather than silently exceed the prompt cap or omit peer rows.
  if (overhead > MAX_BYTES)
    throw new Error("Peer gather scaffolding exceeds the prompt limit");
  const count = Math.max(
    1,
    result.peers.filter((peer) => peer.result !== null).length,
  );
  return build(Math.floor((MAX_BYTES - overhead) / count));
}

type Record = SessionRecord<OctosUiClient>;
export interface GatherRecord {
  readonly scope: Record["scope"];
  readonly closed: boolean;
  readonly runtime: {
    isCurrent(authority: ActiveSessionAuthority<OctosUiClient>): boolean;
    currentAuthority(): ActiveSessionAuthority<OctosUiClient> | null;
    getSnapshot(): { phase: string; recovery: { phase: string } };
  };
  readonly controller: Pick<Record["controller"], "enqueueTurn">;
}
interface GatherRequest {
  record: GatherRecord | null;
  authority: ActiveSessionAuthority<OctosUiClient> | null;
  isRetained(record: GatherRecord): boolean;
  pooledClient(): OctosUiClient | null;
  canSubmit(): boolean;
  reasoningEffort?: ReasoningEffort | undefined;
  slugs?: readonly string[] | undefined;
}
const pending = new WeakMap<
  GatherRecord,
  {
    filter: string;
    operation: Promise<GatherOutcome>;
  }
>();

/** One read-to-enqueue transaction per origin record, never a second queue. */
export function gatherFromRecord(
  request: GatherRequest,
): Promise<GatherOutcome> {
  const { record, authority } = request;
  if (!record || !authority) return Promise.resolve("stale");
  const params =
    request.slugs === undefined ? {} : { slugs: [...request.slugs] };
  const filter = JSON.stringify(params.slugs ?? null);
  const existing = pending.get(record);
  if (existing)
    return existing.filter === filter
      ? existing.operation
      : Promise.resolve("blocked");
  const current = () => {
    const snapshot = record.runtime.getSnapshot();
    return (
      request.isRetained(record) &&
      !record.closed &&
      record.runtime.isCurrent(authority) &&
      record.runtime.currentAuthority()?.capabilities ===
        authority.capabilities &&
      request.pooledClient() === authority.client &&
      authority.client.status === "connected" &&
      snapshot.phase === "ready" &&
      snapshot.recovery.phase === "healthy"
    );
  };
  const operation = Promise.resolve()
    .then(async (): Promise<GatherOutcome> => {
      if (!current() || !authority.capabilities) return "stale";
      const commands = await authority.client.peerCommands(
        record.scope.sessionId,
        record.scope.profileId,
        authority.capabilities,
        record,
      );
      if (!current()) return "stale";
      if (
        commands.scope.authority !== record ||
        commands.scope.sessionId !== record.scope.sessionId ||
        commands.scope.profileId !== record.scope.profileId
      )
        return "failed";
      const result = await commands.gather(params);
      if (!current()) return "stale";
      if (!result.peers.length) return "empty";
      const text = composeGatherPrompt(result);
      if (!current()) return "stale";
      // Reading is permitted without write capability; synthesis is ordinary input.
      if (!request.canSubmit()) return "blocked";
      return record.controller.enqueueTurn({
        turnId: crypto.randomUUID(),
        text,
        ...(request.reasoningEffort
          ? { reasoningEffort: request.reasoningEffort }
          : {}),
      })
        ? "queued"
        : "blocked";
    })
    .catch((): GatherOutcome => (current() ? "failed" : "stale"))
    .finally(() => {
      if (pending.get(record)?.operation === operation) pending.delete(record);
    });
  pending.set(record, { filter, operation });
  return operation;
}
