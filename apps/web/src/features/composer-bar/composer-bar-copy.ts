/**
 * zh for the composer settings row (folder, model, permission, skills,
 * images, usage). Merged into the loaded catalog by ui-text's loader.
 */
export const COMPOSER_BAR_ZH_COPY: Readonly<Record<string, string>> =
  Object.freeze({
    "Message settings": "消息设置",
    "Folder {path}. Start a new session in another folder":
      "文件夹 {path}。在其他文件夹开新会话",
    "Model: {model}": "模型：{model}",
    "Model: {model}. {pending} after the server restarts":
      "模型：{model}。服务器重启后改用 {pending}",
    "Sets this Profile’s default model for every session. The server may need a restart to switch.":
      "改的是这个配置档案的默认模型，所有会话都会用它；服务器可能要重启才会切换。",
    Skills: "技能",
    "Adds a line asking Octos to use the skill. You can edit it.":
      "会在输入框开头加一句「使用某个技能」，可以再改。",
    "Loading skills…": "正在加载技能…",
    "Couldn't load this Profile's skills.": "没能加载这个配置档案的技能。",
    "No skills are installed in this Profile.": "这个配置档案还没有安装技能。",
    "{count} tool(s)": "{count} 个工具",
    "Manage skills…": "管理技能…",
    "Use the {name} skill: ": "使用「{name}」技能：",
    Images: "图片",
    "Attach images": "附加图片",
    "Only images can be attached for now (PNG, JPEG, GIF, WebP).":
      "目前只能附加图片（PNG、JPEG、GIF、WebP）。",
    "{count} tokens": "{count} token",
    "This session used {summary}": "本会话已用 {summary}",
    "Input tokens": "输入 token",
    "Output tokens": "输出 token",
    "Cached input tokens": "缓存命中的输入 token",
    "Estimated cost": "估算费用",
    "Totals for this session as reported by the server. Cost is the server’s estimate from its price table, not a bill.":
      "这是服务端报告的本会话累计用量。费用是服务端按价目表估算的，不是账单。",
    "Runs locally": "本地运行",
    Coding: "编程",
    "Hard problems": "复杂任务",
    Fast: "快",
    "Long documents": "长文档",
    Chinese: "中文",
  });
