import type { UiLanguage } from "../preferences/model.ts";

/**
 * Starter templates for an empty Session ("做同款"). Add, remove, or reorder
 * entries here; nothing else needs to change.
 *
 * A template only fills the composer. The user edits the bracketed parts and
 * sends it themselves. `access` is the least permission the work needs; the
 * home offers a one-click switch when the Session has less, and never raises
 * permission on its own. The model stays a Profile setting (there is no
 * Session-scoped model choice in Core yet, octos#2148).
 *
 * `example` is an illustrative excerpt of a typical result, shown as such. It
 * is not read from the server.
 */
export type TaskTemplateCategory = "code" | "office";
export type TaskTemplateAccess = "read" | "write";

export interface TaskTemplateCopy {
  title: string;
  summary: string;
  prompt: string;
  example: string;
}

export interface TaskTemplate {
  id: string;
  category: TaskTemplateCategory;
  access: TaskTemplateAccess;
  copy: Readonly<Record<UiLanguage, TaskTemplateCopy>>;
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "explain-repository",
    category: "code",
    access: "read",
    copy: {
      en: {
        title: "Understand this repository",
        summary: "A guided tour: purpose, structure, how to run it.",
        prompt:
          "Read through this repository and give me a guided tour, focusing on [the part you want to understand, or leave blank]:\n1. What it does and the main technologies.\n2. The directory layout and what each key module is responsible for.\n3. How to run it locally and how to run the tests.\n4. The five files a newcomer should read first.",
        example:
          "Purpose: browser workspace for coding agents\nStack: React 19 · Vite · TypeScript\nRead first: src/app/App.tsx, packages/client/…",
      },
      zh: {
        title: "读懂这个仓库",
        summary: "一份导览：做什么、怎么组织、怎么跑起来。",
        prompt:
          "通读这个仓库，给我一份导览，重点关注【想深入了解的部分，可以留空】：\n1. 它是做什么的，主要用到哪些技术；\n2. 目录结构和关键模块，各自负责什么；\n3. 怎么在本地跑起来、怎么跑测试；\n4. 新人最该先读的 5 个文件。",
        example:
          "用途：浏览器里的编程工作台\n技术：React 19 · Vite · TypeScript\n先读：src/app/App.tsx、packages/client/…",
      },
    },
  },
  {
    id: "fix-bug",
    category: "code",
    access: "write",
    copy: {
      en: {
        title: "Fix a bug",
        summary: "Find the cause, make the smallest fix, add a test.",
        prompt:
          "Help me fix a bug.\nWhat happens: [what you see]\nHow to trigger it: [steps]\nExpected: [what should happen]\nFind the cause first, make the smallest change that fixes it, and add a test that would catch it again. Tell me which files you changed.",
        example:
          "Cause: retry() never clears its timer after a timeout\nChanged: src/net/retry.ts (+6 −2), retry.test.ts (+1 case)\nTests: 48 passed",
      },
      zh: {
        title: "修一个 bug",
        summary: "先找原因，再做最小修改，补一个测试。",
        prompt:
          "帮我修一个 bug。\n现象：【描述你看到的问题】\n怎么触发：【复现步骤】\n期望：【应该是什么样】\n先找到原因，再做最小的修改，并补一个能防止复发的测试。改完告诉我改了哪些文件。",
        example:
          "原因：retry() 超时后没有清掉计时器\n改动：src/net/retry.ts（+6 −2）、retry.test.ts（+1 个用例）\n测试：48 个通过",
      },
    },
  },
  {
    id: "review-changes",
    category: "code",
    access: "read",
    copy: {
      en: {
        title: "Review recent changes",
        summary: "Issues ranked by severity, with file and line.",
        prompt:
          "Review the recent changes in this repository (uncommitted edits and the last few commits). List problems by severity: likely bugs, edge cases, security risks, readability. Give the file and line for each, and how you would fix it. Review only; do not edit files.",
        example:
          "High · api/upload.ts:42 no size check on uploads\nMedium · Sidebar.tsx:118 no empty state for an empty list\nLow · two duplicate date formatters",
      },
      zh: {
        title: "审一遍最近的改动",
        summary: "按严重程度列问题，写清文件和行号。",
        prompt:
          "审查这个仓库最近的改动（未提交的修改和最近几次提交）。按严重程度列出问题：可能的 bug、边界情况、安全隐患、可读性。每条写清文件和行号，以及建议怎么改。只审不改。",
        example:
          "高 · api/upload.ts:42 上传没有校验文件大小\n中 · Sidebar.tsx:118 列表为空时没有空状态\n低 · 两处重复的日期格式化",
      },
    },
  },
  {
    id: "weekly-report",
    category: "office",
    access: "write",
    copy: {
      en: {
        title: "Write a weekly report",
        summary: "Turn data or notes in this folder into a report.",
        prompt:
          "Using [the data or notes in this folder, e.g. sales.csv], write this week's report and save it as weekly-report.md.\nInclude: highlights (3–5 points), a table of the key numbers, problems and risks, and next week's plan. Every number must match the source files.",
        example:
          "Week 43 report\n• Revenue $184,300, +12.4% week over week\n• 37 new customers, 9 from online channels",
      },
      zh: {
        title: "写周报",
        summary: "把文件夹里的数据或记录整理成一份周报。",
        prompt:
          "根据这个文件夹里的【数据或记录文件，例如 sales.csv】，写一份本周周报，存成 周报.md。\n包括：本周概况（3–5 条要点）、关键数据表格、问题与风险、下周计划。所有数字都要能在原始文件里对得上。",
        example:
          "第 43 周周报\n• 销售额 ¥1,284,300，环比 +12.4%\n• 新客户 37 家，其中 9 家来自线上",
      },
    },
  },
  {
    id: "tidy-spreadsheet",
    category: "office",
    access: "write",
    copy: {
      en: {
        title: "Clean up a spreadsheet",
        summary: "Dedupe, fix formats, save a cleaned copy.",
        prompt:
          "Clean up [the spreadsheet, e.g. customers.csv]: remove duplicate rows, make dates and amounts consistent, fix obvious typos, and sort by [column]. Leave the original untouched and save the result as a new file. Tell me what changed and which rows you were unsure about.",
        example:
          "Removed 23 duplicates · normalized 410 dates\n3 rows need a look\nSaved as customers-cleaned.csv",
      },
      zh: {
        title: "整理表格",
        summary: "去重、统一格式，另存一份干净的。",
        prompt:
          "整理【表格文件，例如 客户名单.csv】：去掉重复行，统一日期和金额格式，修正明显的错别字，按【排序依据】排序。原文件不动，结果另存为一个新文件，并告诉我改了什么、哪些行拿不准。",
        example:
          "去重 23 行 · 统一日期 410 处\n有 3 行拿不准，请确认\n已另存为 客户名单_整理.csv",
      },
    },
  },
  {
    id: "slide-outline",
    category: "office",
    access: "write",
    copy: {
      en: {
        title: "Draft a slide outline",
        summary: "Slide-by-slide titles, points, and charts.",
        prompt:
          "Draft a slide outline on [topic, e.g. Q4 review] for [audience], about [number] slides. For each slide give a title, at most three points, and a suggested chart or image. Use the related material in this folder and save it as slide-outline.md.",
        example:
          "1. Q4 review\n2. Bottom line: revenue +18%, margin flat\n3. Results by region (bar chart)",
      },
      zh: {
        title: "做一份 PPT 提纲",
        summary: "逐页写标题、要点和建议的图表。",
        prompt:
          "为【主题，例如 第四季度复盘】做一份 PPT 提纲，面向【听众】，大约【页数】页。每页写：标题、不超过 3 条要点、建议配的图或表。参考这个文件夹里的相关资料，存成 PPT提纲.md。",
        example:
          "1. 第四季度复盘\n2. 一页结论：收入 +18%，利润率持平\n3. 分区表现（柱状图）",
      },
    },
  },
];

export const TASK_TEMPLATE_CATEGORIES: readonly TaskTemplateCategory[] = [
  "code",
  "office",
];

export function findTaskTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((template) => template.id === id);
}

/** The first bracketed blank (`[…]` or `【…】`) the user should fill in. */
export function firstTemplateBlank(
  text: string,
): { start: number; end: number } | null {
  const match = /【[^】\n]*】|\[[^\]\n]*\]/u.exec(text);
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : null;
}
