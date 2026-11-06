import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TASK_TEMPLATES, TASK_TEMPLATE_CATEGORIES } from "./task-templates.ts";
import {
  TaskTemplateHome,
  browseTemplates,
  templateMatches,
} from "./TaskTemplateHome.tsx";

const ids = (list: readonly { id: string }[]) => list.map((t) => t.id);
const byId = (id: string) => TASK_TEMPLATES.find((t) => t.id === id)!;

describe("browsing templates", () => {
  it("finds the same templates whatever the page language: names and descriptions in both", () => {
    expect(templateMatches(byId("weekly-report"), "周报")).toBe(true);
    expect(templateMatches(byId("weekly-report"), "Weekly")).toBe(true);
    expect(templateMatches(byId("fix-bug"), "BUG")).toBe(true);
    // A summary word, in the other language from the title searched before.
    expect(templateMatches(byId("tidy-spreadsheet"), "dedupe")).toBe(true);
    expect(templateMatches(byId("tidy-spreadsheet"), "去重")).toBe(true);
    // Full-width input is the same as half-width.
    expect(templateMatches(byId("fix-bug"), "ｂｕｇ")).toBe(true);
  });
  it("needs every word, and never searches prompts or examples", () => {
    expect(templateMatches(byId("fix-bug"), "fix test")).toBe(true);
    expect(templateMatches(byId("fix-bug"), "fix spreadsheet")).toBe(false);
    // "retry()" is only in the fix-bug example; "[steps]" only in its prompt.
    expect(templateMatches(byId("fix-bug"), "retry")).toBe(false);
    expect(templateMatches(byId("fix-bug"), "steps")).toBe(false);
    expect(templateMatches(byId("fix-bug"), "   ")).toBe(true);
  });
  it("matches a scene by its name in either language", () => {
    expect(ids(browseTemplates(TASK_TEMPLATES, "all", "办公"))).toEqual(
      ids(TASK_TEMPLATES.filter((t) => t.category === "office")),
    );
    expect(ids(browseTemplates(TASK_TEMPLATES, "all", "office"))).toEqual(
      ids(browseTemplates(TASK_TEMPLATES, "all", "办公")),
    );
  });
  it("combines a scene with a search, and leaves the templates themselves alone", () => {
    const before = JSON.stringify(TASK_TEMPLATES);
    expect(ids(browseTemplates(TASK_TEMPLATES, "office", "表格"))).toEqual([
      "tidy-spreadsheet",
    ]);
    expect(browseTemplates(TASK_TEMPLATES, "code", "表格")).toEqual([]);
    expect(ids(browseTemplates(TASK_TEMPLATES, "code", ""))).toEqual(
      ids(TASK_TEMPLATES.filter((t) => t.category === "code")),
    );
    expect(JSON.stringify(TASK_TEMPLATES)).toBe(before);
  });
  it("every scene has templates, and every template a scene", () => {
    for (const category of TASK_TEMPLATE_CATEGORIES)
      expect(TASK_TEMPLATES.some((t) => t.category === category)).toBe(true);
    for (const template of TASK_TEMPLATES)
      expect(TASK_TEMPLATE_CATEGORIES).toContain(template.category);
  });
  it("an empty catalog renders the home without a search, and unknown shortcut ids show nothing", () => {
    const html = renderToStaticMarkup(
      <TaskTemplateHome
        variant="chooser"
        language="zh"
        catalog={[]}
        shortcuts={{ favorites: ["fix-bug"], recent: ["no-such-template"] }}
        onToggleFavorite={() => {}}
        onUse={() => {}}
      />,
    );
    expect(html).toContain("也可以先挑一个模板");
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain("data-template");
    expect(html).not.toContain("data-shortcut-template");
  });
});
