import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_UI_METHODS,
  OctosUiProtocolError,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { OctosUiRequestTimeoutError } from "@octos-org/octoscode-client";
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

describe("undo this turn: only Core's facts offer it", () => {
  it("offers nothing when snapshots are off, unavailable, unadvertised, or unreadable", async () => {
    for (const setup of [
      fake({ lists: [listing([preTurn], { enabled: false })] }),
      fake({ lists: [listing([preTurn], { available: false })] }),
      fake({ capabilities: caps([CORE_UI_METHODS.SESSION_HYDRATE]) }),
    ]) {
      resetTurnUndoControllers();
      const { controller } = controllerFor(setup.source);
      await controller.load();
      expect(controller.view.status).toBe("hidden");
      await controller.run("undo");
      expect(setup.commands.restoreSnapshot).not.toHaveBeenCalled();
    }
    resetTurnUndoControllers();
    const failing = fake();
    failing.commands.listSnapshots.mockRejectedValueOnce(new Error("closed"));
    const { controller } = controllerFor(failing.source);
    await controller.load();
    expect(controller.view.status).toBe("hidden");
  });

  it("says when snapshots are on but Core kept no point for this turn", async () => {
    const setup = fake({ lists: [listing([preRestore])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    expect(controller.view.status).toBe("missing");
    await controller.run("undo");
    expect(setup.commands.restoreSnapshot).not.toHaveBeenCalled();
  });
});

describe("undo and redo", () => {
  it("restores the turn's own point once, keeps the way back, refreshes, then redoes it", async () => {
    const setup = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([preRestore, preTurn]),
      ],
    });
    const { controller, onSettled } = controllerFor(setup.source);
    await controller.load();
    expect(controller.view.status).toBe("ready");
    // A double click: the second call lands before the first awaits anything.
    const first = controller.run("undo");
    const second = controller.run("undo");
    await Promise.all([first, second]);
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([[preTurn.id]]);
    expect(setup.commands.listSnapshots).toHaveBeenCalledTimes(2);
    expect(setup.lease.rehydrate).toHaveBeenCalledTimes(1);
    expect(setup.lease.release).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(controller.view).toMatchObject({
      status: "undone",
      done: "undo",
      failure: null,
      busy: null,
    });
    expect(controller.undone()).toBe(true);

    await controller.run("redo");
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([
      [preTurn.id],
      [preRestore.id],
    ]);
    expect(controller.view).toMatchObject({ status: "ready", done: "redo" });
    expect(controller.undone()).toBe(false);
  });

  it("finds the way back after a reload, and says when Core no longer lists it", async () => {
    const setup = fake({ lists: [listing([preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");

    resetTurnUndoControllers();
    const reloaded = fake({ lists: [listing([preRestore, preTurn])] });
    const again = controllerFor(reloaded.source).controller;
    await again.load();
    expect(again.view).toMatchObject({ status: "undone", redo: "ok" });

    resetTurnUndoControllers();
    const pruned = fake({ lists: [listing([preTurn])] });
    const gone = controllerFor(pruned.source).controller;
    await gone.load();
    expect(gone.view).toMatchObject({ status: "undone", redo: "gone" });
    await gone.run("redo");
    expect(pruned.commands.restoreSnapshot).not.toHaveBeenCalled();
    expect(gone.view.failure).toMatchObject({ action: "redo", kind: "gone" });
  });

  it("reads a refusal's kind only from Core's structured reason, never its words, and never retries", async () => {
    const setup = fake({ lists: [listing([preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    const words =
      "restore failed: restore refused: files were edited after the snapshot was taken";
    for (const [data, kind] of [
      [undefined, "refused"],
      [{ reason: "files_edited" }, "conflict"],
      [{ reason: "turn_running" }, "running"],
      [{ reason: "something_new" }, "refused"],
    ] as const) {
      setup.commands.restoreSnapshot.mockRejectedValueOnce(
        new OctosUiProtocolError(-32602, words, data),
      );
      await controller.run("undo");
      expect(controller.view).toMatchObject({
        status: "ready",
        failure: { action: "undo", kind, detail: words },
      });
    }
    expect(setup.commands.restoreSnapshot).toHaveBeenCalledTimes(4);
    expect(setup.lease.rehydrate).not.toHaveBeenCalled();
    expect(controller.undone()).toBe(false);
  });

  it("a point Core took before refusing is this tab's own, so the turn stays offered", async () => {
    const refusedPoint: WorkspaceSnapshot = {
      id: "abab7777",
      label: "pre-restore",
      timestamp_unix: 105,
    };
    const setup = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([preRestore, preTurn]),
        listing([refusedPoint, preRestore, preTurn]),
      ],
    });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");
    setup.commands.restoreSnapshot.mockRejectedValueOnce(
      new OctosUiProtocolError(-32602, "restore failed: restore refused"),
    );
    await controller.run("redo");
    expect(controller.view).toMatchObject({
      status: "undone",
      redo: "ok",
      failure: { action: "redo", kind: "refused" },
    });
    await controller.run("redo");
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([
      [preTurn.id],
      [preRestore.id],
      [preRestore.id],
    ]);
    expect(controller.view).toMatchObject({ status: "ready", done: "redo" });
  });

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

  it("the way back is the pre-restore point Core lists above what this page saw, never the newest row", async () => {
    // Core took a tool point right after this restore's own point.
    const toolPoint: WorkspaceSnapshot = {
      id: "cccc3333",
      label: "pre-tool: write_file",
      timestamp_unix: 102,
    };
    const setup = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([toolPoint, preRestore, preTurn]),
      ],
    });
    setup.commands.restoreSnapshot.mockResolvedValueOnce({
      session_id: "s1",
      restored: preTurn.id,
      snapshots: [toolPoint, preRestore, preTurn],
    });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");
    await controller.run("redo");
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([
      [preTurn.id],
      [preRestore.id],
    ]);
    expect(controller.view).toMatchObject({ status: "ready", done: "redo" });
  });

  it("undone without a single new pre-restore point: nothing is offered to bring back", async () => {
    // Core reused an identical state, so its answer lists nothing new.
    const setup = fake({ lists: [listing([preRestore, preTurn])] });
    setup.commands.listSnapshots.mockResolvedValueOnce(listing([preTurn]));
    setup.commands.listSnapshots.mockResolvedValueOnce(listing([preTurn]));
    setup.commands.restoreSnapshot.mockResolvedValueOnce({
      session_id: "s1",
      restored: preTurn.id,
      snapshots: [preTurn],
    });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");
    expect(controller.view).toMatchObject({
      status: "undone",
      redo: "unclear",
      done: "undo",
    });
    await controller.run("redo");
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([[preTurn.id]]);
  });

  it("a restore this tab did not make (another tab, or an answer that never came) is unknown: nothing offered or sent", async () => {
    const elsewhere: WorkspaceSnapshot = {
      id: "dddd4444",
      label: "pre-restore",
      timestamp_unix: 103,
    };
    const setup = fake({ lists: [listing([elsewhere, preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    expect(controller.view.status).toBe("moved");
    await controller.run("undo");
    expect(setup.commands.restoreSnapshot).not.toHaveBeenCalled();

    // This tab's own undo went unanswered, and Core did it: the list read
    // after it shows a point this tab cannot claim, so nothing is offered.
    resetTurnUndoControllers();
    const lost = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([elsewhere, preTurn]),
      ],
    });
    lost.commands.restoreSnapshot.mockRejectedValueOnce(
      new OctosUiRequestTimeoutError(APPUI_SNAPSHOT_METHODS.RESTORE),
    );
    const own = controllerFor(lost.source).controller;
    await own.load();
    await own.run("undo");
    expect(own.view).toMatchObject({
      status: "moved",
      done: null,
      failure: { kind: "uncertain" },
    });
    await own.run("undo");
    expect(lost.commands.restoreSnapshot).toHaveBeenCalledTimes(1);

    // Undone here, then another tab restored again: the way back is not used.
    resetTurnUndoControllers();
    const redone = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([elsewhere, preRestore, preTurn]),
      ],
    });
    const mine = controllerFor(redone.source).controller;
    await mine.load();
    await mine.run("undo");
    await mine.run("redo");
    expect(redone.commands.restoreSnapshot.mock.calls).toEqual([[preTurn.id]]);
    expect(mine.view).toMatchObject({
      status: "moved",
      failure: { action: "redo", kind: "moved" },
    });
  });

  it("this tab's own undo, redo and undo again stay offered", async () => {
    const redoPoint: WorkspaceSnapshot = {
      id: "eeee5555",
      label: "pre-restore",
      timestamp_unix: 104,
    };
    const again: WorkspaceSnapshot = { ...preRestore, id: "ffff6666" };
    const setup = fake({
      lists: [
        listing([preTurn]),
        listing([preTurn]),
        listing([preRestore, preTurn]),
        listing([redoPoint, preRestore, preTurn]),
      ],
    });
    setup.commands.restoreSnapshot
      .mockResolvedValueOnce({
        session_id: "s1",
        restored: preTurn.id,
        snapshots: [preRestore, preTurn],
      })
      .mockResolvedValueOnce({
        session_id: "s1",
        restored: preRestore.id,
        snapshots: [redoPoint, preRestore, preTurn],
      })
      .mockResolvedValueOnce({
        session_id: "s1",
        restored: preTurn.id,
        snapshots: [again, redoPoint, preRestore, preTurn],
      });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");
    await controller.run("redo");
    await controller.run("undo");
    expect(setup.commands.restoreSnapshot.mock.calls).toEqual([
      [preTurn.id],
      [preRestore.id],
      [preTurn.id],
    ]);
    expect(controller.view).toMatchObject({ status: "undone", redo: "ok" });
  });

  it("sends nothing while work is running, or when the point went away", async () => {
    const blocked = fake();
    blocked.binding.acquire.mockImplementation(() => {
      throw new Error("Wait for affected turns.");
    });
    const first = controllerFor(blocked.source).controller;
    await first.load();
    await first.run("undo");
    expect(blocked.commands.restoreSnapshot).not.toHaveBeenCalled();
    expect(first.view.failure).toMatchObject({ kind: "blocked" });

    resetTurnUndoControllers();
    const pruned = fake({ lists: [listing([preTurn]), listing([preRestore])] });
    const second = controllerFor(pruned.source).controller;
    await second.load();
    await second.run("undo");
    expect(pruned.commands.restoreSnapshot).not.toHaveBeenCalled();
    expect(second.view).toMatchObject({
      status: "missing",
      failure: { kind: "gone" },
    });
    expect(pruned.lease.release).toHaveBeenCalledTimes(1);
  });

  it("an earlier turn's undo is remembered per Session, not per page", async () => {
    const setup = fake({ lists: [listing([preTurn])] });
    const { controller } = controllerFor(setup.source);
    await controller.load();
    await controller.run("undo");
    const other = turnUndoController(
      JSON.stringify(["ws://server.test/ui", "another-session"]),
      TURN,
      () => storage,
    );
    expect(other.undone()).toBe(false);
    expect(
      turnUndoController(SCOPE, "another-turn", () => storage).undone(),
    ).toBe(false);
  });
});
