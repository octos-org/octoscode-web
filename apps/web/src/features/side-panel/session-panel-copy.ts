/**
 * zh for the session panel (Overview, Files, Changes, Outputs) and its header
 * toggle. Merged into the loaded catalog by ui-text's loader.
 */
export const SESSION_PANEL_ZH_COPY: Readonly<Record<string, string>> =
  Object.freeze({
    "Session panel": "会话面板",
    "Session panel, {count} changed": "会话面板，{count} 个文件有改动",
    Panel: "面板",
    "Loading session panel…": "正在加载会话面板…",
    "Close session panel": "关闭会话面板",
    "Resize session panel": "调整会话面板宽度",
    Overview: "概览",
    Files: "文件",
    Outputs: "产物",
    // Overview
    "This server doesn't share plans with the Web app.":
      "这个服务器不向网页端提供计划。",
    "Working on it": "进行中的计划",
    "Last plan": "上一个计划",
    "Its turn has ended. A new plan replaces it.":
      "这一轮已经结束。有新计划时会替换它。",
    "No plan yet. When Octos plans a task, its steps and progress show here.":
      "还没有计划。Octos 规划任务后，步骤和进度会显示在这里。",
    // Files
    "Workspace folder": "工作区",
    "Loading folders…": "正在加载文件夹…",
    "More folders here than the server lists at once.":
      "这里的文件夹比服务器一次能列出的多。",
    "No folders here.": "这里没有文件夹。",
    "Nothing changed here yet.": "这里还没有改动。",
    "Outside this folder": "工作区之外",
    "{count} changed": "{count} 个有改动",
    "Show the change to {name}": "查看 {name} 的改动",
    "Shows folders and this session's changed files, not a complete workspace file tree.":
      "这里显示文件夹和本会话里改过的文件，并非工作区的完整文件树。",
    "Shows this session's changed files. This server cannot list workspace folders.":
      "这里显示本会话里改过的文件。服务器不支持列出工作区文件夹。",
    // Changes
    "Uncommitted (Git)": "未提交（Git）",
    "Changed in this session": "本会话改过的文件",
    "Files Octos changes in this session show here.":
      "本会话里 Octos 改过的文件会显示在这里。",
    "Core kept no diff for this change.": "内核没有保留这次改动的差异。",
    Written: "写入",
    Edited: "修改",
    Deleted: "删除",
    Renamed: "重命名",
    "Current workspace file": "当前工作区文件",
    "Selected file": "选中的文件",
    "View changes": "查看改动",
    "Preview file": "预览文件",
    "Clear selection": "清除选择",
    "This file is no longer in the session's retained files. Select another file.":
      "会话保留的文件记录里已没有这个文件，请选择其他文件。",
    "This file was deleted. You can still review its retained diff.":
      "这个文件已删除，仍可查看保留的改动。",
    "This server cannot preview this file. You can review its retained diff if available.":
      "服务器无法预览这个文件；如有保留的改动，仍可查看。",
    // Outputs
    "Nothing yet. Files Octos writes or sends in this session show here.":
      "还没有产物。本会话里 Octos 写出或发给你的文件会显示在这里。",
    "Written in this folder": "写在工作区里",
    "Sent to you": "发给你的",
    "From background tasks": "后台任务产出",
    "All outputs": "全部产物",
    "Loading preview…": "正在加载预览…",
  });
