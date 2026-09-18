import { describe, expect, it, vi } from "vitest";
import type { OctosUiClient } from "@octos-org/octoscode-client";
import type { SessionRecord } from "./session-record-manager.ts";
import type { PromptTurn } from "../composer/turn-queue.ts";
import { SessionComposerDrafts } from "./session-composer-drafts.ts";
import { AttachmentDraftStore } from "../media/attachment-drafts.ts";

// This suite tests draft capture only; dispatch/recovery authority is covered by
// the real queue-controller/record integration suites, not simulated here.
function fixture() {
  const submissions: PromptTurn[] = [];
  let retained = true,
    admitted = true;
  const a = {
    payload: { opened: { reasoning_effort: "high" } },
    controller: {
      submitTurn: (turn: PromptTurn) => {
        if (admitted) submissions.push(turn);
        return admitted;
      },
    },
  } as unknown as SessionRecord<OctosUiClient>;
  const b = {
    payload: { opened: {} },
    controller: a.controller,
  } as unknown as SessionRecord<OctosUiClient>;
  const changed = vi.fn();
  const drafts = new SessionComposerDrafts({
    isRetained: () => retained,
    changed,
  });
  return {
    a,
    b,
    drafts,
    submissions,
    changed,
    retire: () => {
      retained = false;
    },
    block: () => {
      admitted = false;
    },
  };
}

describe("record-owned composer inputs", () => {
  it("keeps full returned drafts in order without replacing new images or another Session", async () => {
    const { a, b, drafts, submissions, retire } = fixture();
    const image = new File(["image bytes"], "original.png", {
      type: "image/png",
    });
    const media = {
      path: `up/${btoa("p1/original").replace(/=/g, "")}/original.png`,
      mime: image.type,
      size_bytes: image.size,
    };
    const upload = vi.fn(async () => media);
    const images = new AttachmentDraftStore({
      scope: { authorityKey: "owner-a", sessionId: "A", profileId: "p1" },
      uploadAvailable: true,
      commands: async () => ({ upload }),
      isCurrent: () => true,
    });
    drafts.get(a).images = images;
    images.selectFiles([image]);
    await images.uploadSelected();
    expect(drafts.enqueue(a, "first returned draft")).toBe(true);
    expect(images.getSnapshot().entries).toEqual([]);
    drafts.setEffort(a, "low");
    expect(drafts.enqueue(a, "second returned draft")).toBe(true);
    // Admission consumes A's media, so a following queued prompt cannot borrow it.
    expect(submissions[1]).not.toHaveProperty("media");
    drafts.restoreUnsentTurn(a, submissions[0]!);
    drafts.restoreUnsentTurn(a, submissions[1]!);
    images.selectFiles([new File(["new"], "new.png", { type: "image/png" })]);
    expect(drafts.consumeRestore(a)).toBeNull();
    expect(drafts.get(a).effort).toBe("low");
    expect(images.getSnapshot().entries[0]?.name).toBe("new.png");
    expect(drafts.consumeRestore(b)).toBeNull();
    images.remove(images.getSnapshot().entries[0]!.id);
    expect(drafts.consumeRestore(a)).toBe("first returned draft");
    expect(drafts.get(a).effort).toBe("high");
    expect(images.getSnapshot().entries[0]).toMatchObject({
      name: "original.png",
      status: "ready",
    });
    expect(drafts.consumeRestore(a)).toBeNull();
    expect(drafts.enqueue(a, "first returned draft")).toBe(true);
    expect(submissions[2]).toMatchObject({
      media: [media],
      reasoningEffort: "high",
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(drafts.consumeRestore(a)).toBe("second returned draft");
    expect(drafts.get(a).effort).toBe("low");
    expect(drafts.consumeRestore(a)).toBeNull();
    drafts.restoreInterruptPrompt(a, "interrupted prompt");
    expect(drafts.consumeRestore(a)).toBe("interrupted prompt");
    expect(drafts.consumeRestore(a)).toBeNull();
    drafts.restoreUnsentTurn(a, submissions[0]!);
    drafts.retire(a);
    retire();
    drafts.restoreUnsentTurn(a, submissions[0]!);
    expect(drafts.peekRestore(a)).toBeNull();
    expect(images.getSnapshot().disposed).toBe(true);
  });
  it("keeps reasoning visibility per record without changing captured effort or transcript state", () => {
    const { a, b, drafts, submissions, changed, retire } = fixture();
    expect(drafts.get(a).showReasoning).toBe(true);
    expect(drafts.get(b).showReasoning).toBe(true);
    drafts.enqueue(a, "keep high effort");
    drafts.setShowReasoning(a, false);
    expect(drafts.get(a).showReasoning).toBe(false);
    expect(drafts.get(b).showReasoning).toBe(true);
    expect(drafts.get(a).effort).toBe("high");
    expect(submissions[0]?.reasoningEffort).toBe("high");
    expect(submissions[0]).not.toHaveProperty("showReasoning");
    expect(changed).toHaveBeenCalled();
    retire();
    drafts.setShowReasoning(a, true);
    expect(drafts.get(a).showReasoning).toBe(false);
  });
  it("restores server thinking choice once and captures each queue entry independently", () => {
    const { a, b, drafts, submissions } = fixture();
    expect(drafts.get(a).effort).toBe("high");
    expect(drafts.get(b).effort).toBeUndefined();
    expect(drafts.enqueue(a, "first")).toBe(true);
    drafts.setEffort(a, "low");
    expect(drafts.enqueue(a, "second")).toBe(true);
    expect(drafts.get(b).effort).toBeUndefined();
    drafts.setEffort(a, undefined);
    expect(drafts.enqueue(a, "third")).toBe(true);
    expect(submissions.map((turn) => turn.reasoningEffort)).toEqual([
      "high",
      "low",
      undefined,
    ]);
    expect(new Set(submissions.map((turn) => turn.turnId)).size).toBe(3);
    expect(submissions[2]).not.toHaveProperty("reasoningEffort");
    expect(drafts.get(a).effort).toBeUndefined();
  });
  it("retired owners cannot enqueue or mutate a new Session's inputs", () => {
    const { a, drafts, submissions, retire } = fixture();
    drafts.get(a);
    retire();
    drafts.setEffort(a, "max");
    expect(drafts.get(a).effort).toBe("high");
    expect(drafts.enqueue(a, "stale")).toBe(false);
    expect(submissions).toEqual([]);
  });
  it("failed local admission reports kept draft and leaves input choice unchanged", () => {
    const { a, drafts, submissions, block } = fixture();
    block();
    expect(drafts.enqueue(a, "keep me")).toBe(false);
    expect(drafts.get(a)).toMatchObject({
      effort: "high",
      error: expect.stringContaining("draft was kept"),
    });
    expect(submissions).toEqual([]);
  });
});
