import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeerDock, type PeerDockManager } from "./PeerDock.tsx";
import type { PeerManagerSnapshot, PeerRosterEntry } from "./peer-manager.ts";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";

function entry(overrides: Partial<PeerRosterEntry>): PeerRosterEntry {
  return {
    identity: "peer-1",
    profileId: "profile",
    topic: "topic",
    slug: "peer-one",
    cwd: "/srv/work",
    briefPath: "/srv/work/brief.md",
    origin: "prepare",
    turnId: "turn-1",
    status: "started",
    activity: "idle",
    openedAt: null,
    finishedAt: null,
    error: null,
    canRetry: false,
    ...overrides,
  };
}

function managerFor(peers: readonly PeerRosterEntry[]): PeerDockManager {
  const value: PeerManagerSnapshot = {
    peers,
    blackboard: [],
    prepareBusy: false,
    gatherBusy: false,
    prepareError: null,
    gatherError: null,
    prepareUncertain: false,
    dispatchRefusalKind: null,
  };
  return { subscribe: () => () => undefined, getSnapshot: () => value };
}

const ROSTER: readonly PeerRosterEntry[] = [
  entry({
    identity: "p-live",
    slug: "fence-live",
    activity: "live",
    status: "started",
    openedAt: 1,
    outputTokens: 1234,
    acknowledgment: { kind: "sent", action: "steer" },
  }),
  entry({
    identity: "p-opening",
    slug: "fence-opening",
    activity: "idle",
    status: "opening",
  }),
  entry({
    identity: "p-blocked",
    slug: "fence-blocked",
    activity: "blocked",
    status: "unknown",
  }),
  entry({
    identity: "p-failed",
    slug: "fence-failed",
    activity: "done",
    status: "failed",
    outcome: "failed",
  }),
  entry({
    identity: "p-closed",
    slug: "fence-closed",
    activity: "done",
    status: "closed",
    outcome: "finished",
  }),
  entry({
    identity: "p-stopped",
    slug: "fence-stopped",
    activity: "done",
    status: "closed",
    outcome: "stopped",
    acknowledgment: { kind: "stop-requested" },
  }),
];

function renderChinese(element: ReactElement): string {
  return renderToStaticMarkup(
    <UiTextProvider language="zh" catalog={zh}>
      {element}
    </UiTextProvider>,
  );
}

describe("PeerDock Chinese presentation", () => {
  it("localizes dock chrome, lifecycle, activity, outcome, and acknowledgment text", () => {
    const markup = renderChinese(<PeerDock manager={managerFor(ROSTER)} />);

    expect(markup).toContain('aria-label="协作者"');
    expect(markup).toContain("隐藏协作者");
    expect(markup).toContain('aria-label="会话协作者"');
    expect(markup).toContain(">已启动</span>");
    expect(markup).toContain(">正在打开</span>");
    expect(markup).toContain(">失败</span>");
    expect(markup).toContain(">未知</span>");
    expect(markup).toContain(">已关闭</span>");
    expect(markup).toContain('class="sr-only">正在输出</span>');
    expect(markup).toContain('class="sr-only">需要你</span>');
    expect(markup).toContain("· 已完成");
    expect(markup).toContain("· 已停止");
    expect(markup).toContain("· 已失败");
    expect(markup).toContain("· 已发送");
    expect(markup).toContain("· 已请求停止");
  });

  it("explains compact elapsed and token values in Chinese", () => {
    const markup = renderChinese(
      <PeerDock manager={managerFor([ROSTER[0]!])} />,
    );

    expect(markup).toContain('title="协作者运行时间"');
    expect(markup).toContain('title="输出 token"');
    expect(markup).toContain("↓ 1.2k");
    expect(markup).toContain("· 运行");
    expect(markup).toContain("· 输出 1234 token");
    expect(markup).not.toContain('aria-label="协作者运行时间 ');
    expect(markup).not.toContain('aria-label="输出 token 1234"');
  });

  it("renders retained peers without an active manager but hides foreign actions", () => {
    const markup = renderChinese(
      <PeerDock
        manager={null}
        roster={[ROSTER[0]!]}
        actionRoster={[]}
        onRowAction={() => {}}
      />,
    );

    expect(markup).toContain("fence-live");
    expect(markup).not.toContain("data-row-action");
  });

  it("localizes every collapsed-pill count segment", () => {
    const markup = renderChinese(
      <PeerDock manager={managerFor(ROSTER)} collapsed />,
    );

    expect(markup).toContain(
      "协作者 6 · 1 进行中 · 3/6 已完成 · 1 已阻止 · 3 已完成",
    );
    expect(markup).not.toContain(" live");
    expect(markup).not.toContain(" landed");
    expect(markup).not.toContain(" blocked");
    expect(markup).not.toContain(" done");
  });
});
