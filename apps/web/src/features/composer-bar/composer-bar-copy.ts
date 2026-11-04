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
    Files: "文件",
    "Attach files": "附加文件",
    "Attach CSV, Markdown, text, PDF or image files":
      "附加 CSV、Markdown、文本、PDF 或图片",
    "Add skills or files": "添加技能或文件",
    Add: "添加",
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
    // T-0364: the pre-send estimate.
    "This message ≈{count} tokens": "本条约 {count} token",
    "{label}, estimated": "{label}（估算）",
    "Before sending": "发送前估算",
    "This message": "这条消息",
    "Context so far": "已有上下文",
    "After sending": "发送后",
    "≈{percent}% of {window}": "约占 {window} 的 {percent}%",
    "Not counted": "未计入",
    "Estimated from the character count, the same way the server estimates its context. The model’s own count will differ.":
      "按字数估算，和服务器估算上下文的方法相同；模型实际的计数会有出入。",
    "This server has not reported the context for this session.":
      "服务器没有报告这个会话的上下文。",
    "The context window is known after the first reply in this session.":
      "上下文窗口要等这个会话第一次回复后才知道。",
    "{count} attachments are not counted; their size is only known once sent.":
      "{count} 个附件未计入，发送后才知道它们有多大。",
    "No price before sending: nothing here knows one. Usage and the server’s cost estimate appear after the reply.":
      "发送前不显示价格：这里没有可靠的单价。实际用量和服务器的费用估算会在回复后显示。",
    "{label}, estimated. The server will compact first.":
      "{label}（估算）。服务器会先压缩上下文。",
    "With this message the context reaches the server’s compaction threshold of about {threshold}, so it will compact older messages first.":
      "加上这条消息，上下文会达到服务器的压缩阈值（约 {threshold}），服务器会先压缩较早的内容。",
    "The context is the server’s estimate of the last prompt it sent, instructions and tool definitions included.":
      "已有上下文是服务器对它上一次发给模型的内容的估算，包含系统说明和工具说明。",
    "The context is the server’s estimate of the conversation so far; instructions and tool definitions sent with every request are not in it.":
      "已有上下文是服务器对目前对话内容的估算，不含每次请求都会带上的系统说明和工具说明。",
    "Not included: the reply, and this turn’s tool calls and their output.":
      "未计入：模型的回复，以及这一轮的工具调用和输出。",
  });
