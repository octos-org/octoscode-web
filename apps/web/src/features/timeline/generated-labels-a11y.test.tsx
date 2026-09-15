import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import { REASONING_ZH_COPY } from "../reasoning/reasoning-copy.ts";
import { SESSION_CONFIG_ZH_COPY } from "../session-config/session-config-copy.ts";
import { FLEET_ZH_COPY } from "../fleet/fleet-copy.ts";
import { ThinkingDisclosure } from "./ThinkingDisclosure.tsx";
import { TurnActivityIndicator } from "./TurnActivityIndicator.tsx";
import { ToolCallDisclosure } from "./ToolCallDisclosure.tsx";
import type { TimelineEntry } from "./model.ts";
import { dispositionNotice } from "../session-config/SessionConfigPane.tsx";

/**
 * Judge r2 #8 (round 3): generated labels + live-region announcements render
 * in BOTH languages. RED: the components interpolate English literals without
 * the t() seam, so zh input still renders English.
 */
const zhCatalog = {
  ...REASONING_ZH_COPY,
  ...SESSION_CONFIG_ZH_COPY,
  ...FLEET_ZH_COPY,
};

const reasoningEntry: TimelineEntry = {
  id: "reasoning:turn-1",
  kind: "reasoning",
  title: "Reasoning",
  body: "one two three four five six",
  status: "complete",
  turnId: "turn-1",
  startedAtMs: 0,
  endedAtMs: 12_400,
};

const zh = (node: React.ReactElement) =>
  renderToStaticMarkup(<UiTextProvider language="zh" catalog={zhCatalog}>{node}</UiTextProvider>);

describe("generated transcript labels render localized (judge #8)", () => {
  it("ThinkingDisclosure renders the zh one-line summary", () => {
    const html = zh(
      <ThinkingDisclosure entry={reasoningEntry} expanded={false} onToggle={() => {}} />,
    );
    expect(html).toContain("思考 · 12 秒 · 6 词");
    expect(html).not.toContain("Thinking · ");
  });

  it("ThinkingDisclosure renders zh without a duration while streaming", () => {
    const streaming: TimelineEntry = { ...reasoningEntry };
    delete streaming.endedAtMs;
    const html = zh(
      <ThinkingDisclosure entry={streaming} expanded={false} onToggle={() => {}} />,
    );
    expect(html).toContain("思考 · 6 词");
  });

  it("TurnActivityIndicator announces the zh status word", () => {
    const html = zh(
      <TurnActivityIndicator
        activity={{ label: "Thinking…", startedAtMs: 0, lastAtMs: 1 }}
      />,
    );
    expect(html).toContain("思考中…");
    expect(html).not.toContain("Thinking…");
  });

  it("TurnActivityIndicator announces a zh tool word", () => {
    const html = zh(
      <TurnActivityIndicator
        activity={{
          label: "Running shell…",
          template: "Running {value0}…",
          params: { value0: "shell" },
          startedAtMs: 0,
          lastAtMs: 1,
        }}
      />,
    );
    expect(html).toContain("正在运行 shell…");
  });

  it("ToolCallDisclosure keeps tool prose untranslated (server data)", () => {
    const tool: TimelineEntry = {
      id: "tool:call-1",
      kind: "tool",
      title: "shell",
      body: '{"cmd": "cargo test"}',
      status: "complete",
      turnId: "turn-1",
      startedAtMs: 0,
      endedAtMs: 3_400,
    };
    const html = zh(
      <ToolCallDisclosure entry={tool} expanded={false} onToggle={() => {}} />,
    );
    expect(html).toContain("shell");
    expect(html).toContain("cargo test");
  });

  it("dispositionNotice localizes through the optional translator seam", () => {
    const t = (source: string, params?: Record<string, string | number>) =>
      source.replace(/\{([^{}]+)\}/g, (_m, name: string) =>
        params && name in params ? String(params[name]) : _m,
      );
    const zhT = (source: string, params?: Record<string, string | number>) => {
      const translated = SESSION_CONFIG_ZH_COPY[source] ?? source;
      return t(translated, params);
    };
    expect(
      dispositionNotice(
        { disposition: "reloaded", saved: { selection: "glm-5.3" } },
        zhT,
      ),
    ).toBe("已保存。你的下一条消息将使用 glm-5.3");
    expect(
      dispositionNotice({ disposition: "unchanged" }, zhT),
    ).toBe("已选择此模型");
  });
});
