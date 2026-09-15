# 最后一轮阅读与导航审计

本轮遵循 [前端基线](../frontend-baseline.md)，独立检查 timeline / Markdown
/ 代码、侧栏树与搜索、工作目录选择、Diff 和任务输出。复核前两轮交接记录后，使用独立开发服务 54223 和受控协议 fixture
55223 实际操作 Chromium；未操作现有真实会话或线上配置。

## 发现和修复

1. **已经下发的长历史仍无法阅读。**
   注入 360 条合法 hydrate 消息后，浏览器只剩 199 条内容和一个截断提示。旧提示让用户重新打开会话，但 hydrate 再次执行同一 200 条删除逻辑，无法找回前面的记录。现在 projection 保留已收到的数据，Timeline 仅把初始 DOM 限为最近 200 条，通过 Show
   earlier messages 每次显示最多 100 条更早内容。浏览器实际验证 200 → 300 →
   360 条，第一条内容可找回；展开时原首行的位置保持在 4px 容差内，随后 25 个流式增量也不会把历史读者拖回底部。窗口以条目身份保持，真实 Session
   key 负责会话切换时重置。常规 hydrate 使用索引写入与一次终态标记，避免把完整已完成历史按每条消息、每个回合重复扫描。
2. **原生按钮的 Enter 被树的键盘导航截获。** 实际聚焦 New session in
   final-reading 并按 Enter，会折叠工作区，既有会话行全部消失，没有创建新会话。树快捷键现在只处理树容器自己的焦点，子按钮保留原生行为。测试验证 Enter 后确实出现第二条会话。
3. **树焦点和搜索的退出不完整。**
   ArrowRight 在已展开的工作区上不进入子会话；搜索关闭后焦点仍在不可见输入框；aria-activedescendant 可能指向已经移除的搜索结果。现已补全向右进入子项、搜索按钮焦点恢复与失效活动节点清理。IME
   / keyCode
   229 不触发退出或导航。手机抽屉 Escape 的分层由本轮输入审计负责，双方已协调处理。
4. **复制代码的失败没有反馈。** 剪贴板拒绝产生未处理 Promise；没有 Clipboard
   API 时直接抛错。现在复制等待实际完成，失败显示可重试说明并保留代码；成功后才显示 Copied。实际分别拒绝、移除、恢复 Clipboard
   API，错误和成功状态均正确，未出现 pageerror。可选语法包请求失败也保留可读、可复制的纯代码；实测拦截 Python
   grammar 后页面继续使用。
5. **手机任务输出的标题和固定分栏占满可用高度。** 320×480 下长标题和旧 260px +
   180px 分栏下限把标题/输出/附件挤出弹层；滚动附件后截图顶部只剩被裁切的标题尾部。现用局部 CSS 约束 Grid 列与最小高度，标题省略但保留完整 title，输出与附件使用可缩小的内部滚动区。实际完成 Check
   report → Load more artifact 后，build completed 可见，关闭按钮始终在视口内。
6. **Diff 长标题把操作推到页面外。**
   320px 视口中，超长服务端标题使关闭按钮右边界达到 x=3821.9px。现通过 DiffReviewDialog
   CSS
   Module 约束列宽和标题，保留完整标题、文件路径的原生提示；关闭、Refresh、文件展开/折叠与内部横向代码滚动均可用。

## 浏览器证据

新增 [final-reading.spec.ts](../../e2e/final-reading.spec.ts)
七项实际浏览器用例，完整执行 **7/7 通过，19.7 秒**。长历史用例还检查：

- 原始 HTML
  script 不执行；javascript 链接不成为链接；Markdown 远程图片不会产生网络请求；用户主动导航的 HTTPS 链接保留 noopener
  / noreferrer。
- 320×480 深色与 640×360 浅色、reduced
  motion 下，代码和表格的实际边界均在视口内；长代码可横向滚动，窄表格保留独立滚动容器。640×360 表示 1280×720 在 200% 缩放后的 CSS 布局空间，**不是实际浏览器缩放快捷键的测试**。
- 加载更早条目、手动滚动、接收流式内容、回到最新内容使用真实点击和滚轮。测试并非只比较 document.scrollWidth。
- 最后补强不同 Session 复用同样 hydrate fallback
  ID 的切换用例，确认进入新 Session 重新从 200 条初始窗口开始，补强后该用例单独通过（6.6 秒）。

已人工查看的最终截图：

- [320px 任务输出](evidence/2026-09-15/task-output-320.png)
- [320px Diff 审查](evidence/2026-09-15/diff-review-320.png)
- [320px 深色长历史](evidence/2026-09-15/history-320-dark.png)
- [640px 浅色长历史](evidence/2026-09-15/history-640-light.png)

定向六个测试文件
**55 项单测通过**，覆盖 projection、Timeline、侧栏、任务输出、Diff 与 Markdown。格式、局部 lint 和 CSS/token/ownership
policy 通过。早先 Web
typecheck 通过；最终局部复验期间 commands 测试曾出现并行修改中的 SetStateAction 类型错误，现已修复，整合类型检查和完整门禁均通过，见[最终报告](2026-09-15-final-audit.md)。

## 边界

Show earlier
messages 展示的是当前浏览器已经收到的条目；它不请求或假定存在服务端未提供的历史。展开更多内容会增加 DOM 和内存，初始 200 条限制不是完整虚拟列表，也不代表无限长度会话已做性能保证。工作目录选择复核未发现本轮新增独立缺陷；其创建/IME/取消行为继续由现有 onboarding 和 workspace 回归覆盖。

本轮没有给 provider 延迟合成进度，也没有修改服务端持久化、会话发现或脱离浏览器执行的契约。总体生产体积、完整浏览器集、真实 Core 集成与其他代理交叉修复，由最后整合审计统一记录。
