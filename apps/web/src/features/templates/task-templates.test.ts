import { describe, expect, it } from "vitest";
import { TASK_TEMPLATES, firstTemplateBlank } from "./task-templates.ts";
import { formatOpenedAt } from "./TaskTemplateHome.tsx";

describe("task templates", () => {
  it("finds the first blank in either bracket style, never across lines", () => {
    expect(firstTemplateBlank("Fix [what] in [where]")).toEqual({
      start: 4,
      end: 10,
    });
    expect(firstTemplateBlank("整理【表格文件】：去重")).toEqual({
      start: 2,
      end: 8,
    });
    expect(firstTemplateBlank("[open\nclose]")).toBeNull();
    expect(firstTemplateBlank("No blanks here.")).toBeNull();
  });

  it("ships every template complete in both languages, first blank near the top", () => {
    // The composer is three rows tall; prefill selects the first blank after
    // scrolling to the top, so a blank further down would open half hidden.
    expect(new Set(TASK_TEMPLATES.map((t) => t.id)).size).toBe(
      TASK_TEMPLATES.length,
    );
    for (const template of TASK_TEMPLATES) {
      for (const language of ["en", "zh"] as const) {
        const copy = template.copy[language];
        for (const value of Object.values(copy)) {
          expect(value.trim(), `${template.id}/${language}`).not.toBe("");
        }
        const blank = firstTemplateBlank(copy.prompt);
        if (blank) {
          const line = copy.prompt.slice(0, blank.start).split("\n").length;
          expect(line, `${template.id}/${language}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("formats the last-opened time in the UI language", () => {
    const now = Date.UTC(2026, 9, 28, 12);
    expect(formatOpenedAt(now - 5_000, "en", now)).toBe("now");
    expect(formatOpenedAt(now - 3 * 3_600_000, "en", now)).toBe("3 hours ago");
    expect(formatOpenedAt(now - 3 * 3_600_000, "zh", now)).toBe("3小时前");
    expect(formatOpenedAt(now - 10 * 86_400_000, "zh", now)).toMatch(/10月/);
  });
});
