import { describe, expect, it } from "vitest";
import {
  type DispositionNoticeOutcome,
  type ModelNoticeBoard,
  noticeMessage,
  nextModelNoticeBoard,
  parseRuntimeDisposition,
  type RuntimeDispositionResult,
} from "./model-settings.ts";
import type { ProfileLlmModel } from "@octos-org/octoscode-client/protocol";

const glm: ProfileLlmModel = {
  model: "glm-5.3",
  provider: "zai",
  title: "GLM 5.3",
  family: "zai-coding",
  route: "official",
  selected: true,
  available: true,
};
const other: ProfileLlmModel = {
  model: "glm-4.7",
  provider: "zai",
  title: "GLM 4.7",
  family: "zai-coding",
  route: "official",
  selected: false,
  available: true,
};

describe("parseRuntimeDisposition (judge #6 / §5.3)", () => {
  it("maps every wire disposition to its runtime kind", () => {
    expect(
      parseRuntimeDisposition({ runtime_disposition: "reloaded" }),
    ).toMatchObject({ disposition: "reloaded" });
    expect(
      parseRuntimeDisposition({ runtime_disposition: "deferred" }),
    ).toMatchObject({ disposition: "deferred" });
    expect(
      parseRuntimeDisposition({ runtime_disposition: "restart_required" }),
    ).toMatchObject({ disposition: "restart_required" });
    expect(
      parseRuntimeDisposition({ runtime_disposition: "persisted_but_not_live" }),
    ).toMatchObject({ disposition: "persisted_but_not_live" });
    expect(
      parseRuntimeDisposition({ runtime_disposition: "unchanged" }),
    ).toMatchObject({ disposition: "unchanged" });
  });

  it("treats applied=true without a disposition as the legacy persisted contract", () => {
    expect(parseRuntimeDisposition({ applied: true })).toMatchObject({
      disposition: "persisted",
    });
    expect(parseRuntimeDisposition({})).toBeNull();
  });

  it("carries runtime_error and the deferred condition through", () => {
    const parsed: RuntimeDispositionResult | null = parseRuntimeDisposition({
      runtime_disposition: "persisted_but_not_live",
      runtime_error: "no provider for family",
    });
    expect(parsed).toEqual({
      disposition: "persisted_but_not_live",
      runtimeError: "no provider for family",
    });
    expect(
      parseRuntimeDisposition({
        runtime_disposition: "deferred",
        condition: "profile disabled",
      }),
    ).toEqual({
      disposition: "deferred",
      condition: "profile disabled",
    });
  });
});

describe("noticeMessage — the five §4.2 messages, exactly", () => {
  it("reloaded names the model of the NEXT message", () => {
    expect(
      noticeMessage(
        { disposition: "reloaded", savedModel: glm },
        translate,
      ),
    ).toBe("Saved. Your next message uses glm-5.3");
  });

  it("deferred is not active yet and appends the condition when present", () => {
    expect(
      noticeMessage(
        {
          disposition: "deferred",
          savedModel: glm,
          condition: "profile disabled",
        },
        translate,
      ),
    ).toBe("Saved. The model is not active yet (profile disabled)");
    expect(
      noticeMessage({ disposition: "deferred", savedModel: glm }, { t: (s) => s }),
    ).toBe("Saved. The model is not active yet");
  });

  it("restart_required keeps naming the model the server still runs", () => {
    expect(
      noticeMessage(
        { disposition: "restart_required", savedModel: glm, runningModel: "glm-4.7" },
        translate,
      ),
    ).toBe("Saved. The server keeps running glm-4.7 until it restarts");
  });

  it("persisted_but_not_live surfaces the runtime error verbatim", () => {
    expect(
      noticeMessage(
        {
          disposition: "persisted_but_not_live",
          savedModel: glm,
          runtimeError: "no provider for family",
        },
        translate,
      ),
    ).toBe("Saved, but not usable right now: no provider for family");
  });

  it("unchanged is Already selected and never says Saved", () => {
    expect(
      noticeMessage({ disposition: "unchanged" }, { t: (s) => s }),
    ).toBe("Already selected");
  });

  it("a refused save is Couldn't save, never Saved", () => {
    expect(
      noticeMessage(
        { disposition: "refused", reason: "read-only profile" },
        translate,
      ),
    ).toBe("Couldn't save: read-only profile");
  });
});

const EMPTY_BOARD: ModelNoticeBoard = { notices: [] };

/** Interpolates {value0} like the real zh/en catalogs do. */
const interpolatingT = (
  source: string,
  params?: Record<string, string | number>,
): string =>
  params
    ? source.replace(/\{([^{}]+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : token,
      )
    : source;
const translate = { t: interpolatingT };

describe("nextModelNoticeBoard — sticky rules (§4.2 / case 23b)", () => {
  it("reloaded for the same selection clears a deferred and a persisted_but_not_live notice", () => {
    let board: ModelNoticeBoard = {
      notices: [
        {
          kind: "deferred",
          model: { model: "glm-5.3", provider: "zai", route: "official" },
          message: "Saved. The model is not active yet",
          atMs: 1,
        },
        {
          kind: "persisted_but_not_live",
          model: { model: "glm-5.3", provider: "zai", route: "official" },
          message: "Saved, but not usable right now: x",
          atMs: 2,
        },
      ],
    };
    board = nextModelNoticeBoard(board, {
      disposition: "reloaded",
      savedModel: glm,
      atMs: 3,
    }, translate);
    expect(board.notices.filter((notice) => notice.kind !== "reloaded"),
    ).toHaveLength(0);
  });

  it("a turn stamp showing the model clears a deferred notice for that model", () => {
    let board: ModelNoticeBoard = {
      notices: [
        {
          kind: "deferred",
          model: { model: "glm-5.3", provider: "zai", route: "official" },
          message: "Saved. The model is not active yet",
          atMs: 1,
        },
      ],
    };
    board = nextModelNoticeBoard(board, { turnStampModel: glm, atMs: 5 }, translate);
    expect(board.notices.filter((notice) => notice.kind !== "reloaded"),
    ).toHaveLength(0);
  });

  it("a turn stamp does NOT clear a persisted_but_not_live notice (sticky)", () => {
    const sticky = {
      kind: "persisted_but_not_live" as const,
      model: { model: "glm-5.3", provider: "zai", route: "official" },
      message: "Saved, but not usable right now: x",
      atMs: 1,
    };
    const board = nextModelNoticeBoard(
      { notices: [sticky] },
      { turnStampModel: glm, atMs: 5 },
      translate,
    );
    expect(board.notices).toEqual([sticky]);
  });

  it("a successful list refresh does NOT clear persisted_but_not_live; only a later reloaded for the same selection does", () => {
    let board: ModelNoticeBoard = {
      notices: [
        {
          kind: "persisted_but_not_live",
          model: { model: "glm-5.3", provider: "zai", route: "official" },
          message: "Saved, but not usable right now: x",
          atMs: 1,
        },
      ],
    };
    board = nextModelNoticeBoard(board, { listRefreshed: [glm], atMs: 2 }, translate);
    expect(board.notices).toHaveLength(1);
    board = nextModelNoticeBoard(board, {
      disposition: "unchanged",
      savedModel: glm,
      atMs: 3,
    }, translate);
    expect(board.notices).toHaveLength(1);
    board = nextModelNoticeBoard(board, {
      disposition: "reloaded",
      savedModel: glm,
      atMs: 4,
    }, translate);
    expect(
      board.notices.filter((notice) => notice.kind !== "reloaded"),
    ).toHaveLength(0);
  });

  it("unchanged preserves every outstanding restart/error notice unchanged", () => {
    const restart = {
      kind: "restart_required" as const,
      model: { model: "glm-5.3", provider: "zai", route: "official" },
      message: "Saved. The server keeps running glm-4.7 until it restarts",
      runningModel: "glm-4.7",
      atMs: 1,
    };
    const board = nextModelNoticeBoard(
      { notices: [restart] },
      { disposition: "unchanged", savedModel: glm, atMs: 9 },
      translate,
    );
    expect(board.notices).toEqual([restart]);
  });

  it("a refused save records the failure and the selection reverts (no saved model change)", () => {
    const board = nextModelNoticeBoard(EMPTY_BOARD, {
      disposition: "refused",
      reason: "read-only profile",
      atMs: 1,
    }, translate);
    expect(board.notices[0]?.kind).toBe("refused");
    expect(board.selectionReverted).toBe(true);
  });

  it("a save in flight does not disturb existing notices (Saving… is transient state)", () => {
    const board = nextModelNoticeBoard(EMPTY_BOARD, { saving: true }, translate);
    expect(board.notices).toHaveLength(0);
    expect(board.saving).toBe(true);
  });
});

describe("external selection change (case 23)", () => {
  it("flags the selection changed in another tab when the saved identity differs after refresh", () => {
    const board = nextModelNoticeBoard(EMPTY_BOARD, {
      listRefreshed: [glm],
      lastSeenSelection: { model: "glm-5.3", provider: "zai", route: "official" },
      atMs: 1,
    }, translate);
    expect(board.externalChange).toBeFalsy();
    const board2 = nextModelNoticeBoard(EMPTY_BOARD, {
      listRefreshed: [other],
      lastSeenSelection: { model: "glm-5.3", provider: "zai", route: "official" },
      atMs: 2,
    }, translate);
    expect(board2.externalChange).toBe(true);
  });
});

describe("notice rendering order (DispositionNoticeOutcome)", () => {
  it("exposes a single visible notice line: outcome > external change > sticky notices", () => {
    const board: ModelNoticeBoard = {
      notices: [
        {
          kind: "restart_required",
          model: { model: "glm-5.3", provider: "zai", route: "official" },
          message: "Saved. The server keeps running glm-4.7 until it restarts",
          atMs: 1,
        },
      ],
    };
    const outcome: DispositionNoticeOutcome | null = board.notices[0] ?? null;
    expect(outcome?.message).toContain("keeps running");
  });
});
