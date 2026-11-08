import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { OctosUiRequestTimeoutError } from "@octos-org/octoscode-client";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import {
  APPUI_SNAPSHOT_METHODS,
  type SnapshotList,
  type WorkspaceSnapshot,
} from "@octos-org/octoscode-client/history";
import type { StorageLike } from "../connection/preferences.ts";
import type { HistoryBinding } from "./history-binding.ts";
import { resetTurnUndoControllers, turnUndoController } from "./turn-undo.ts";

const caps = (methods: string[]): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: [],
});
const FULL = caps([
  CORE_UI_METHODS.SESSION_HYDRATE,
  APPUI_SNAPSHOT_METHODS.LIST,
  APPUI_SNAPSHOT_METHODS.RESTORE,
]);
const TURN = "00000000-0000-4000-8000-0000000000aa";
const SCOPE = JSON.stringify(["ws://server.test/ui", "workspace-session"]);
const preTurn: WorkspaceSnapshot = {
  id: "aaaa1111",
  label: `pre-turn ${TURN}`,
  timestamp_unix: 100,
  turn_id: TURN,
};
const preRestore: WorkspaceSnapshot = {
  id: "bbbb2222",
  label: "pre-restore",
  timestamp_unix: 101,
};
const listing = (
  snapshots: WorkspaceSnapshot[],
  patch: Partial<SnapshotList> = {},
): SnapshotList => ({
  session_id: "s1",
  enabled: true,
  available: true,
  snapshots,
  ...patch,
});

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function fake({
  capabilities = FULL,
  lists = [listing([preTurn])],
}: { capabilities?: UiProtocolCapabilities; lists?: SnapshotList[] } = {}) {
  let listed = 0;
  const lease = {
    isCurrent: vi.fn(() => true),
    release: vi.fn(),
    rehydrate: vi.fn(async () => ({}) as never),
    openFork: vi.fn(),
    applyPrefill: vi.fn(() => false),
  };
  const commands = {
    listSnapshots: vi.fn(
      async () => lists[Math.min(listed++, lists.length - 1)]!,
    ),
    restoreSnapshot: vi.fn(async (id: string) => ({
      session_id: "s1",
      restored: id,
      snapshots: [{ ...preRestore }, preTurn],
    })),
  };
  const binding = {
    capabilities,
    blockedReason: vi.fn((): string | null => null),
    acquire: vi.fn(() => lease),
    commands: vi.fn(async () => commands),
  };
  return {
    binding,
    lease,
    commands,
    source: async () => binding as unknown as HistoryBinding,
  };
}

let storage: StorageLike;
beforeEach(() => {
  resetTurnUndoControllers();
  storage = memoryStorage();
});
const controllerFor = (
  source: () => Promise<HistoryBinding>,
  onSettled = vi.fn(),
) => {
  const controller = turnUndoController(SCOPE, TURN, () => storage);
  controller.attach(source, onSettled);
  return { controller, onSettled };
};

describe("undo and redo", () => {
  it("an unanswered restore is unknown: refreshed, not replayed, not claimed", async () => {
    const setup = fake({ lists: [listing([preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    setup.commands.restoreSnapshot.mockRejectedValueOnce(
      new OctosUiRequestTimeoutError(APPUI_SNAPSHOT_METHODS.RESTORE),
    );
    await controller.run("undo");
    expect(setup.commands.restoreSnapshot).toHaveBeenCalledTimes(1);
    expect(setup.lease.rehydrate).toHaveBeenCalledTimes(1);
    expect(controller.view).toMatchObject({
      status: "ready",
      done: null,
      failure: { kind: "uncertain" },
    });
    expect(controller.undone()).toBe(false);
  });

  it("an undo retried after a failure can be redone to the point Core reused", async () => {
    // The failed attempt's own pre-restore point; the retry finds the files
    // unchanged, so Core reuses it and lists nothing new.
    const failed = { ...preRestore, id: "cccc3333" };
    const setup = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([failed, preTurn]),
      ],
    });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    setup.commands.restoreSnapshot.mockRejectedValueOnce(
      new OctosUiProtocolError(-32603, "restore incomplete: created.txt"),
    );
    await controller.run("undo");
    expect(controller.view).toMatchObject({ failure: { kind: "refused" } });
    setup.commands.restoreSnapshot.mockResolvedValueOnce({
      session_id: "s1",
      restored: preTurn.id,
      snapshots: [failed, preTurn],
    });
    await controller.run("undo");
    expect(controller.view).toMatchObject({ status: "undone", redo: "ok" });
    await controller.run("redo");
    expect(setup.commands.restoreSnapshot).toHaveBeenLastCalledWith(failed.id);
  });

  it("a reused point that is not a pre-restore one leaves redo unclear", async () => {
    const setup = fake({ lists: [listing([preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    setup.commands.restoreSnapshot.mockResolvedValueOnce({
      session_id: "s1",
      restored: preTurn.id,
      snapshots: [preTurn],
    });
    await controller.run("undo");
    expect(controller.view).toMatchObject({
      status: "undone",
      redo: "unclear",
    });
  });
});
