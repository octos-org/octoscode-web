import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import { REASONING_ZH_COPY } from "../reasoning/reasoning-copy.ts";
import { SessionStatusStrip } from "./SessionStatusStrip.tsx";

/**
 * Judge r2 #8 (round 3): the strip's live third segment must announce in BOTH
 * catalogs. RED: the strip renders activity.label raw, so zh input still
 * announces English.
 */
const zhCatalog = { ...REASONING_ZH_COPY };

const zh = (node: React.ReactElement) =>
  renderToStaticMarkup(
    <UiTextProvider language="zh" catalog={zhCatalog}>
      {node}
    </UiTextProvider>,
  );

describe("SessionStatusStrip live word localizes (judge #8)", () => {
  it("announces the zh thinking word in the third segment while responding", () => {
    const html = zh(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "responding" }}
        activity={{
          label: "Thinking…",
          startedAtMs: 0,
          lastAtMs: 1,
        }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("思考中…");
    expect(html).not.toContain("Thinking…");
  });

  it("announces a zh tool word with the untranslated tool name", () => {
    const html = zh(
      <SessionStatusStrip
        model="glm-5.3"
        permissionMode="Workspace write"
        state={{ kind: "responding" }}
        activity={{
          label: "Running shell…",
          template: "Running {value0}…",
          params: { value0: "shell" },
          startedAtMs: 0,
          lastAtMs: 1,
        }}
        onOpenPane={() => {}}
      />,
    );
    expect(html).toContain("正在运行 shell…");
    expect(html).not.toContain("Running shell…");
  });
});
