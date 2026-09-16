import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { InspectionCommands } from "@octos-org/octoscode-client/inspection";
import type {
  SessionRecord,
  SessionRecordManager,
} from "../session/session-record-manager.ts";
import {
  sessionRuntimeScopeKey,
  type SessionRuntimeScope,
} from "../session/session-scope.ts";

export interface InspectionBinding {
  readonly scope: Readonly<SessionRuntimeScope>;
  readonly authorityKey: string;
  readonly capabilities: UiProtocolCapabilities;
  isCurrent(): boolean;
  subscribe(listener: () => void): () => void;
  commands(): Promise<InspectionCommands>;
}
export function createInspectionBinding({
  manager,
  record,
  isSourceCurrent,
}: {
  manager: SessionRecordManager<OctosUiClient>;
  record: SessionRecord<OctosUiClient>;
  /** Captured pool/transport/auth-epoch fence, independent of UI selection. */
  isSourceCurrent(): boolean;
}): InspectionBinding {
  const authority = record.runtime.currentAuthority();
  if (!authority?.capabilities || !record.payload)
    throw new Error(
      "Open a confirmed Session before inspecting threads or turns.",
    );
  const scope = Object.freeze({ ...record.scope });
  const { client, capabilities, generation } = authority;
  const commandAuthority = Object.freeze({});
  const isCurrent = () => {
    const current = record.runtime.currentAuthority();
    const state = record.runtime.getSnapshot();
    return (
      isSourceCurrent() &&
      manager.get(scope) === record &&
      !record.closed &&
      record.runtime.isCurrent(authority) &&
      client.status === "connected" &&
      state.phase === "ready" &&
      state.recovery.phase === "healthy" &&
      current?.config.endpoint === scope.endpoint &&
      current.sessionId === scope.sessionId &&
      current.profileId === scope.profileId &&
      current.cwd === scope.workspaceRoot &&
      current.capabilities === capabilities
    );
  };
  const assertCurrent = () => {
    if (!isCurrent())
      throw new Error(
        "Inspection Session authority changed. Reopen the inspector.",
      );
  };
  assertCurrent();
  let pending: Promise<InspectionCommands> | undefined;
  let guarded: InspectionCommands | undefined;
  return {
    scope,
    authorityKey: JSON.stringify([sessionRuntimeScopeKey(scope), generation]),
    capabilities,
    isCurrent,
    subscribe: manager.subscribe,
    async commands() {
      assertCurrent();
      pending ??= client
        .inspectionCommands(
          scope.sessionId,
          scope.profileId,
          capabilities,
          commandAuthority,
        )
        .catch((reason: unknown) => {
          pending = undefined;
          throw reason;
        });
      const commands = await pending;
      assertCurrent();
      if (
        commands.scope.authority !== commandAuthority ||
        commands.scope.sessionId !== scope.sessionId ||
        commands.scope.profileId !== scope.profileId
      )
        throw new Error("Inspection commands resolved for another owner.");
      guarded ??= Object.freeze({
        scope: commands.scope,
        available: commands.available,
        async readApprovalScopes() {
          assertCurrent();
          const result = await commands.readApprovalScopes();
          assertCurrent();
          return result;
        },
        async readThreadGraph() {
          assertCurrent();
          const result = await commands.readThreadGraph();
          assertCurrent();
          return result;
        },
        async readTurnState(turnId: string) {
          assertCurrent();
          const result = await commands.readTurnState(turnId);
          assertCurrent();
          return result;
        },
      });
      return guarded;
    },
  };
}
