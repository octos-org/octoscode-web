import { describe, expect, it, vi } from "vitest";
import {
  buildLoopCreationInput,
  createLoopCreationSubmission,
  parseLoopCreationInterval,
  type LoopCreationDraft,
} from "./loop-creation.ts";

const fixed = (interval = "5m"): LoopCreationDraft => ({
  mode: "fixed_interval",
  prompt: "Check the deployment",
  interval,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
describe("native loop creation validation", () => {
  it.each([
    ["60s", 60],
    ["60sec", 60],
    ["60secs", 60],
    ["1m", 60],
    ["5min", 300],
    ["5mins", 300],
    ["2h", 7200],
    ["2hr", 7200],
    ["24hrs", 86400],
    ["1d", 86400],
    ["1day", 86400],
    ["1days", 86400],
    ["60000ms", 60],
    [" 5m ", 300],
  ])("preserves TUI interval %s as %i native seconds", (raw, seconds) => {
    expect(parseLoopCreationInterval(String(raw))).toMatchObject({
      ok: true,
      seconds,
      truncatedMilliseconds: false,
    });
  });
  it("matches integer millisecond Duration::as_secs without accepting decimal units", () => {
    expect(parseLoopCreationInterval("60999ms")).toEqual({
      ok: true,
      seconds: 60,
      truncatedMilliseconds: true,
    });
    expect(parseLoopCreationInterval("59999ms").ok).toBe(false);
    expect(parseLoopCreationInterval("1.5m").ok).toBe(false);
  });
  it.each([
    "",
    "60",
    "0s",
    "59s",
    "86401s",
    "25h",
    "2d",
    "-60s",
    "+60s",
    "60.0s",
    "1e3s",
    "5M",
    "5minutes",
    "5 m",
    "5m extra",
    "every 5m",
    "NaN",
    "Infinity",
    "18446744073709551616s",
    "18446744073709551615d",
  ])("fails closed for malformed or out-of-policy interval %s", (raw) => {
    expect(parseLoopCreationInterval(raw).ok).toBe(false);
    expect(buildLoopCreationInput(fixed(raw)).ok).toBe(false);
  });
  it("allows native bare maintenance while keeping prompt modes explicit and isolated", () => {
    expect(
      buildLoopCreationInput({
        mode: "maintenance",
        prompt: " \n ",
        interval: "not-a-cadence",
      }),
    ).toEqual({ ok: true, input: { mode: "maintenance", prompt: "" } });
    expect(
      buildLoopCreationInput({
        mode: "self_paced",
        prompt: " Check health ",
        interval: "5m",
      }),
    ).toEqual({
      ok: true,
      input: { mode: "self_paced", prompt: "Check health" },
    });
    expect(buildLoopCreationInput(fixed())).toEqual({
      ok: true,
      input: {
        mode: "fixed_interval",
        prompt: "Check the deployment",
        interval_seconds: 300,
      },
    });
    for (const mode of ["self_paced", "fixed_interval"])
      expect(
        buildLoopCreationInput({ mode, prompt: " ", interval: "5m" }).ok,
      ).toBe(false);
    expect(
      buildLoopCreationInput({ mode: "invalid", prompt: "x", interval: "5m" })
        .ok,
    ).toBe(false);
  });
  it("uses Core's UTF-8 byte quota and never spreads routing/alias fields from drafts", () => {
    expect(
      buildLoopCreationInput({ ...fixed(), prompt: "😀".repeat(2048) }).ok,
    ).toBe(true);
    expect(
      buildLoopCreationInput({ ...fixed(), prompt: "😀".repeat(2049) }).ok,
    ).toBe(false);
    const draft = {
      ...fixed(),
      session_id: "foreign",
      profile_id: "foreign",
      command: "/loop 1s injected",
    };
    expect(buildLoopCreationInput(draft)).toEqual({
      ok: true,
      input: {
        mode: "fixed_interval",
        prompt: "Check the deployment",
        interval_seconds: 300,
      },
    });
  });
});

describe("explicit loop creation submission", () => {
  it("captures one immutable draft and deduplicates repeated submission while pending", async () => {
    const submission = createLoopCreationSubmission();
    const response = deferred<boolean>();
    const createLoop = vi.fn(() => response.promise);
    const draft = fixed();
    const first = submission.submit(draft, createLoop);
    draft.prompt = "changed after click";
    draft.interval = "2h";
    expect(submission.submit(draft, createLoop)).toBe(first);
    await Promise.resolve();
    expect(createLoop).toHaveBeenCalledTimes(1);
    expect(createLoop).toHaveBeenCalledWith({
      mode: "fixed_interval",
      prompt: "Check the deployment",
      interval_seconds: 300,
    });
    response.resolve(true);
    expect(await first).toMatchObject({
      kind: "confirmed",
      input: { prompt: "Check the deployment" },
    });
  });
  it("does not send invalid input or a submission cancelled before dispatch", async () => {
    const submission = createLoopCreationSubmission();
    const createLoop = vi.fn(async () => true);
    expect(await submission.submit(fixed("5"), createLoop)).toMatchObject({
      kind: "invalid",
    });
    const pending = submission.submit(fixed(), createLoop);
    submission.cancel();
    expect(await pending).toEqual({ kind: "stale" });
    expect(createLoop).not.toHaveBeenCalled();
  });
  it("does not let an old receipt clear a restarted form's pending ownership", async () => {
    const submission = createLoopCreationSubmission();
    const old = deferred<boolean>();
    const next = deferred<boolean>();
    const createLoop = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const first = submission.submit(fixed(), createLoop);
    await Promise.resolve();
    submission.cancel();
    const second = submission.submit(
      { mode: "maintenance", prompt: "", interval: "" },
      createLoop,
    );
    await Promise.resolve();
    old.resolve(true);
    expect(await first).toEqual({ kind: "stale" });
    expect(submission.submit(fixed(), createLoop)).toBe(second);
    expect(createLoop).toHaveBeenCalledTimes(2);
    next.resolve(true);
    expect(await second).toMatchObject({
      kind: "confirmed",
      input: { mode: "maintenance", prompt: "" },
    });
  });
  it("makes ambiguous failures visible without retrying or echoing remote credentials", async () => {
    const submission = createLoopCreationSubmission();
    const createLoop = vi.fn(async () => {
      throw new Error("remote-secret-material");
    });
    const receipt = await submission.submit(fixed(), createLoop);
    expect(receipt).toMatchObject({ kind: "unconfirmed" });
    expect(JSON.stringify(receipt)).toContain("Refresh the loop list");
    expect(JSON.stringify(receipt)).not.toContain("remote-secret-material");
    expect(createLoop).toHaveBeenCalledTimes(1);
  });
});
