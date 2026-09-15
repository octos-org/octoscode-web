import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "../approval/ApprovalPanel.tsx";
import { UserQuestionPanel } from "../questions/UserQuestionPanel.tsx";
import { ConnectionPanel } from "../connection/ConnectionPanel.tsx";
import { CommandPalette } from "../commands/CommandPalette.tsx";
import { WEB_COMMANDS } from "../commands/registry.ts";
import { LoopCreationControls } from "../autonomy/LoopCreationControls.tsx";
import { ReasoningDialog } from "../reasoning/ReasoningDialog.tsx";
import { InspectionContent } from "../inspection/InspectionDialog.tsx";
import { ProductSidebarViewOptionsMenu } from "../shell/ProductSidebar.tsx";
import { UiTextProvider, createUiText } from "./ui-text.tsx";
import zh from "./zh.ts";

function chinese(children: ReactNode) {
  return renderToStaticMarkup(
    <UiTextProvider language="zh" catalog={zh}>
      {children}
    </UiTextProvider>,
  );
}

describe("Chinese browser feature presentation", () => {
  it("covers command metadata and preserves every interpolation placeholder", () => {
    for (const command of WEB_COMMANDS) {
      expect(zh[command.description], command.name).toBeTruthy();
      expect(zh[command.category], command.category).toBeTruthy();
    }
    for (const [source, translated] of Object.entries(zh)) {
      expect(translated.match(/\{\w+\}/g)?.sort() ?? [], source).toEqual(
        source.match(/\{\w+\}/g)?.sort() ?? [],
      );
    }
    expect(createUiText("zh", zh)("Session {id}", { id: "A#peer" })).toBe(
      "会话 A#peer",
    );
    expect(createUiText()("Session {id}", { id: "A#peer" })).toBe(
      "Session A#peer",
    );
    expect(createUiText("zh", zh)("Unknown native error")).toBe(
      "Unknown native error",
    );
  });

  it("renders connection controls without changing input values or server errors", () => {
    const onChange = vi.fn();
    const html = chinese(
      <ConnectionPanel
        value={{
          endpoint: "https://server.invalid",
          token: "synthetic-only",
          sessionId: "coding:local:A",
          profileId: "coding",
          cwd: "/srv/英文",
        }}
        status="error"
        error="Native server rejected connection"
        onChange={onChange}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onForget={vi.fn()}
      />,
    );
    expect(html).toContain("连接 Octos");
    expect(html).toContain("认证令牌");
    expect(html).toContain('value="https://server.invalid"');
    expect(html).toContain('value="synthetic-only"');
    expect(html).toContain("Native server rejected connection");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("localizes approval actions but not native text, commands, or shortcut keys", () => {
    const onDecide = vi.fn();
    const html = chinese(
      <ApprovalPanel
        approval={{
          sessionId: "coding:local:A#peer",
          approvalId: "a",
          turnId: "t",
          toolName: "shell",
          title: "Approval required",
          body: "This session",
          typedDetails: { command: { command_line: "printf 'Yes'" } },
        }}
        busy={false}
        error={null}
        onDecide={onDecide}
      />,
    );
    expect(html).toContain("需要批准");
    expect(html).toContain('id="approval-title">Approval required');
    expect(html).toContain("<p>This session</p>");
    expect(html).toContain("printf &#x27;Yes&#x27;");
    expect(html).toContain("此会话");
    expect(html).toContain("否 <kbd>N");
    expect(html).toContain("是 <kbd>Y");
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("keeps native question options canonical even when matching catalog keys", () => {
    const html = chinese(
      <UserQuestionPanel
        request={{
          sessionId: "coding:local:A",
          questionId: "q",
          turnId: "t",
          title: "Choose checks",
          body: "Choose one",
          questions: [
            {
              header: "Checks",
              question: "Continue?",
              options: [{ label: "Yes", description: "Continue" }],
              multiSelect: false,
              allowFreeText: true,
            },
          ],
        }}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toContain("Choose checks");
    expect(html).toContain("<strong>Yes</strong>");
    expect(html).toContain("<small>Continue</small>");
    expect(html).toContain("继续");
    expect(html).toContain("输入其他回答");
  });

  it("translates command descriptions without translating command identifiers", () => {
    const command = WEB_COMMANDS.find(
      (candidate) => candidate.name === "lang",
    )!;
    const html = chinese(
      <CommandPalette
        id="commands"
        commands={[command]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(html).toContain("/lang");
    expect(html).toContain("选择英文或中文界面");
    expect(html).toContain("设置");
    expect(
      renderToStaticMarkup(
        <CommandPalette
          id="commands"
          commands={[command]}
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      ),
    ).toContain(command.description);
  });

  it("renders controlled grouping and native form options with unchanged values", () => {
    const menu = chinese(
      <ProductSidebarViewOptionsMenu
        viewMode="flat"
        orderMode="manual"
        onViewModeChange={vi.fn()}
        onOrderModeChange={vi.fn()}
      />,
    );
    expect(menu).toContain('aria-label="会话分组方式"');
    expect(menu).toMatch(/aria-checked="true"[^>]*><span>统一列表<\/span>/);
    const createLoop = vi.fn();
    const loop = chinese(
      <LoopCreationControls enabled busy={false} createLoop={createLoop} />,
    );
    expect(loop).toContain('value="maintenance" selected="">维护');
    expect(loop).toContain('value="fixed_interval">固定间隔');
    expect(loop).toContain('value="self_paced">自定节奏');
    expect(createLoop).not.toHaveBeenCalled();
    const reasoning = chinese(
      <ReasoningDialog
        sessionId="coding:local:A#peer"
        value="high"
        disabled={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(reasoning).toContain('value="high" selected="">高');
    expect(reasoning).toContain("coding:local:A#peer");
  });

  it("localizes inspection framing, leaving wire decisions and identifiers untouched", () => {
    const html = chinese(
      <InspectionContent
        result={{
          kind: "approval-scopes",
          value: {
            scopes: [
              {
                session_id: "coding:local:A",
                scope: "tool",
                scope_match: "/srv/英文",
                decision: "deny",
                turn_id: "turn-native",
              },
            ],
          },
        }}
      />,
    );
    expect(html).toContain("已记住的批准范围");
    expect(html).toContain("deny");
    expect(html).toContain("turn-native");
    expect(html).toContain("/srv/英文");
    expect(html).not.toContain("<button");
  });
});
