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
export type TaskTemplateCategory = "code" | "office" | "general";
/** `draft`: the answer is written in the conversation; no file, no SET. */
export type TaskTemplateAccess = "read" | "write" | "draft";

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
    id: "repository-health",
    category: "code",
    access: "read",
    copy: {
      en: {
        title: "Check repository health",
        summary: "Find concrete risks and missing tests without changing code.",
        prompt:
          "Check the health of [the module or workflow to examine] in the selected workspace.\nRead its implementation, configuration and tests. Prioritize concrete bugs, error handling gaps and untested boundaries. For each finding give a file and line, a reproducible example or supporting evidence, its impact and a suggested fix. Do not edit files or install dependencies. Ask before running commands that write data or access the network. State what you could not verify; do not invent findings.",
        example:
          "High · import.ts:42 malformed rows abort the entire import\nEvidence: the parser throws before the per-row error handler\nSuggested test: valid row followed by a malformed row",
      },
      zh: {
        title: "代码体检",
        summary: "找出有证据的风险和测试缺口，只审不改。",
        prompt:
          "为当前工作区的【要检查的模块或流程】做一次代码体检。\n阅读相关实现、配置和测试，优先检查真实 bug、错误处理和未覆盖的边界。每条问题写清文件与行号、复现示例或证据、影响和修改建议。不要改文件或安装依赖；需要写入数据或联网的命令先问我。说明哪些结论尚未验证，不要编造问题。",
        example:
          "高 · import.ts:42 一行格式错误会中断整批导入\n证据：解析器在逐行错误处理之前抛错\n建议用例：正常行后接一行错误数据",
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
        summary: "Turn data or notes into a report.",
        prompt:
          "Using [the data or notes: drop a file here or name one in this folder, e.g. sales.csv], write this week's report and save it as weekly-report.md.\nInclude: highlights (3–5 points), a table of the key numbers, problems and risks, and next week's plan. Every number must match the source files. Use only facts supplied by the user or the referenced materials. Clearly label any inference or recommendation, and never present unknown information as decided or confirmed.",
        example:
          "Week 43 report\n• Revenue $184,300, +12.4% week over week\n• 37 new customers, 9 from online channels",
      },
      zh: {
        title: "写周报",
        summary: "把数据或记录整理成一份周报。",
        prompt:
          "根据【数据或记录文件，可以拖进来，也可以写这个文件夹里的文件名，例如 sales.csv】，写一份本周周报，存成 周报.md。\n包括：本周概况（3–5 条要点）、关键数据表格、问题与风险、下周计划。所有数字都要能在原始文件里对得上。只使用用户或参考资料中提供的事实；推测和建议必须明确标注，不能把未知信息写成已确定或已确认。",
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
          "Clean up [the spreadsheet: drop it here or name it, e.g. customers.csv]: remove duplicate rows, make dates and amounts consistent, fix obvious typos, and sort by [column]. Leave the original untouched and save the result as a new file. Tell me what changed and which rows you were unsure about. Use only facts supplied by the user or the referenced materials. Clearly label any inference or recommendation, and never present unknown information as decided or confirmed.",
        example:
          "Removed 23 duplicates · normalized 410 dates\n3 rows need a look\nSaved as customers-cleaned.csv",
      },
      zh: {
        title: "整理表格",
        summary: "去重、统一格式，另存一份干净的。",
        prompt:
          "整理【表格文件，可以拖进来，也可以写文件名，例如 客户名单.csv】：去掉重复行，统一日期和金额格式，修正明显的错别字，按【排序依据】排序。原文件不动，结果另存为一个新文件，并告诉我改了什么、哪些行拿不准。只使用用户或参考资料中提供的事实；推测和建议必须明确标注，不能把未知信息写成已确定或已确认。",
        example:
          "去重 23 行 · 统一日期 410 处\n有 3 行拿不准，请确认\n已另存为 客户名单_整理.csv",
      },
    },
  },
  {
    id: "research-topic",
    category: "general",
    access: "read",
    copy: {
      en: {
        title: "Research a topic",
        summary: "Compare sources and separate evidence from open questions.",
        prompt:
          "Research [topic and the decision this should inform] using [provided materials or public links].\nSummarize the key findings, compare the options in a table and cite a source for each factual claim. Distinguish facts, inferences and recommendations, including dates where relevant. Use only the materials I identify and available public sources; do not search private folders. If web access or a source is unavailable, say so and ask for the missing material. Reply here without changing files.",
        example:
          "Option A: lower setup cost (source, date)\nOption B: supports offline work (source, date)\nStill unknown: support response time",
      },
      zh: {
        title: "调研一个主题",
        summary: "对照资料列出结论、出处和待确认的问题。",
        prompt:
          "围绕【调研主题和要支持的决策】，使用【提供的资料或公开链接】做一份调研。\n先总结关键发现，再用表格比较方案，每条事实标明出处，必要时注明日期。区分事实、推测和建议。只使用我指定的材料和可访问的公开来源，不搜索私有目录；无法联网或读取来源时明确说明，并向我索取缺少的材料。在回复里给出结果，不修改文件。",
        example:
          "方案 A：初始成本较低（来源、日期）\n方案 B：支持离线使用（来源、日期）\n待确认：支持服务的响应时间",
      },
    },
  },
  {
    id: "polish-writing",
    category: "office",
    access: "write",
    copy: {
      en: {
        title: "Polish a draft",
        summary:
          "Improve structure and clarity while keeping your facts intact.",
        prompt:
          "Polish [the text pasted here, attached file or named file in this workspace] for [audience and tone].\nImprove its structure, clarity and wording while preserving the author's meaning, numbers and quotations. Flag unsupported claims or missing information instead of inventing details. Save a separate polished copy in this workspace without overwriting the original, and summarize the main edits. Read only the materials I specify.",
        example:
          "Structure: lead with the request, then give context\nWording: shorten repeated explanations\nNeeds confirmation: the delivery date",
      },
      zh: {
        title: "文稿打磨",
        summary: "理顺结构、改进表达，保留事实和原稿。",
        prompt:
          "打磨【粘贴的正文、附件或当前工作区里的文件名】，面向【读者和希望的语气】。\n调整结构、精简表达，保留作者原意、数字和引文。缺少依据或信息时标注待确认，不编造细节。在当前工作区另存一份润色稿，不覆盖原稿，并简述主要修改。只读取我指定的材料。",
        example:
          "结构：先说明诉求，再补充背景\n表达：删去重复解释，缩短长句\n待确认：交付日期",
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
          "Draft a slide outline on [topic, e.g. Q4 review] for [audience], about [number] slides. For each slide give a title, at most three points, and a suggested chart or image. Use the related material in this folder and save it as slide-outline.md. Use only facts supplied by the user or the referenced materials. Clearly label any inference or recommendation, and never present unknown information as decided or confirmed.",
        example:
          "1. Q4 review\n2. Bottom line: revenue +18%, margin flat\n3. Results by region (bar chart)",
      },
      zh: {
        title: "写演示提纲",
        summary: "逐页写标题、要点和建议的图表。",
        prompt:
          "为【主题，例如 第四季度复盘】写一份演示提纲，面向【听众】，大约【页数】页。每页写：标题、不超过 3 条要点、建议配的图或表。参考这个文件夹里的相关资料，存成 演示提纲.md。只使用用户或参考资料中提供的事实；推测和建议必须明确标注，不能把未知信息写成已确定或已确认。",
        example:
          "1. 第四季度复盘\n2. 一页结论：收入 +18%，利润率持平\n3. 分区表现（柱状图）",
      },
    },
  },
];

export const TASK_TEMPLATE_CATEGORIES: readonly TaskTemplateCategory[] = [
  "code",
  "office",
  "general",
];

/**
 * The Chat home's templates (two-modes proposal §3, behind the two-modes
 * flag). A chat is read-only with no network, so each asks for a Markdown
 * draft written here in the conversation from what the user pastes or
 * uploads, and none promises a saved file. `access: "draft"` keeps the
 * template flow from changing the chat's permission either way.
 */
export const CHAT_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "chat-weekly-report",
    category: "general",
    access: "draft",
    copy: {
      en: {
        title: "Write a weekly report",
        summary: "Turn pasted or uploaded notes and data into a report.",
        prompt:
          "Using [the notes or data I paste or upload, e.g. sales.csv], draft this week's report here in the chat as Markdown. Don't create files.\nInclude: highlights (3–5 points), a table of the key numbers, problems and risks, and next week's plan. Every number must match what I gave you; label any inference as such.",
        example:
          "Week 43 report\n• Revenue $184,300, +12.4% week over week\n• 37 new customers, 9 from online channels",
      },
      zh: {
        title: "写周报",
        summary: "把粘贴或上传的记录和数据整理成周报。",
        prompt:
          "根据【我粘贴或上传的记录或数据，例如 sales.csv】，直接在对话里用 Markdown 起草本周周报，不要创建文件。\n包括：本周概况（3–5 条要点）、关键数据表格、问题与风险、下周计划。所有数字都要和我给的材料对得上；推测要明确标出来。",
        example:
          "第 43 周周报\n• 销售额 ¥1,284,300，环比 +12.4%\n• 新客户 37 家，其中 9 家来自线上",
      },
    },
  },
  {
    id: "chat-tidy-csv",
    category: "general",
    access: "draft",
    copy: {
      en: {
        title: "Clean up a CSV",
        summary: "Dedupe and fix formats in an uploaded CSV.",
        prompt:
          "Clean up [the CSV I upload, e.g. customers.csv]: remove duplicate rows, make dates and amounts consistent and sort by [column]. Show the cleaned rows here in the chat as a Markdown table or CSV block, then list what changed and which rows you were unsure about. Don't create files.",
        example:
          "Removed 23 duplicates · normalized 410 dates\n3 rows need a look",
      },
      zh: {
        title: "整理 CSV",
        summary: "把上传的 CSV 去重并统一格式。",
        prompt:
          "整理【我上传的 CSV，例如 客户名单.csv】：去掉重复行，统一日期和金额格式，按【排序依据】排序。把整理好的内容直接在对话里给出（Markdown 表格或 CSV 代码块），再说明改了什么、哪些行拿不准。不要创建文件。",
        example: "去重 23 行 · 统一日期 410 处\n有 3 行拿不准，请确认",
      },
    },
  },
  {
    id: "chat-slide-outline",
    category: "general",
    access: "draft",
    copy: {
      en: {
        title: "Draft a slide outline",
        summary: "Slide-by-slide titles, points and charts.",
        prompt:
          "Draft a slide outline on [topic, e.g. Q4 review] for [audience], about [number] slides, here in the chat as Markdown. For each slide give a title, at most three points and a suggested chart or image. Use material I paste or upload. Don't create files.",
        example:
          "1. Q4 review\n2. Bottom line: revenue +18%, margin flat\n3. Results by region (bar chart)",
      },
      zh: {
        title: "写演示提纲",
        summary: "逐页写标题、要点和建议的图表。",
        prompt:
          "为【主题，例如 第四季度复盘】写一份演示提纲，面向【听众】，大约【页数】页，直接在对话里用 Markdown 写。每页写：标题、不超过 3 条要点、建议配的图或表。参考我粘贴或上传的材料。不要创建文件。",
        example:
          "1. 第四季度复盘\n2. 一页结论：收入 +18%，利润率持平\n3. 分区表现（柱状图）",
      },
    },
  },
];

export function findTaskTemplate(id: string): TaskTemplate | undefined {
  return [...TASK_TEMPLATES, ...CHAT_TEMPLATES].find(
    (template) => template.id === id,
  );
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
