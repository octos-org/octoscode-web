# octoscode-web — Codex 0.10 审计邀请

> 2026-09-15 · 你的角色：**零上下文审计 + 验证我们的解决方案**
> 我们不需要你修 bug。我们需要你确认我们的修复是正确的，并从全新视角找出我们遗漏的问题。

---

## 这是什么

octoscode-web 是 Octos coding UI
Protocol 的浏览器客户端。浏览器不拥有 agent 真相——一切由本地 `octos serve`
通过 WebSocket UI Protocol 提供。

- pnpm workspace：`apps/web`（React 19 + Vite + CSS Module）+
  `packages/client`（无 React 协议库）
- 部署：nginx 静态 + `/api/` 反代；CSP
  `connect-src 'self'`（安全边界，不要放松）
- `pnpm check` = 格式 + 策略(2877 行 CSS 预算) + 许可 + lint + 类型 +
  **466 单元测试** + 构建 + 部署产物
- `pnpm test:e2e` = 97 项（含 axe a11y、视觉基线、LoAF <200ms 帧预算、键盘导航）

## 我们最近解决了什么（请验证）

### Timeline 体验重建（#71-#77）

**解决了**：发送消息后到首个内容之间的视觉真空、reasoning/tool/assistant 无时序关系、tool 输出占满全屏。

方案：reasoning 按 tool 边界分段（`reasoning:{turnId}:{toolCount}`）；`<details>`
折叠块（流式 open、完成 collapse）；tool 输出 500 char cap；`turn_terminal`
sweep 全匹配分段 ID；CSS 动效层（`interpolate-size` + `::details-content`
transition，`cubic-bezier(0.16,1,0.3,1)` 全覆盖）。

**请验证**：折叠/展开动画是否在所有浏览器正常；`::details-content`
fallback 是否可接受；分段 reasoning 的 ID 生成是否有边界 case。

### 深度思考指示器（#74 + 修复）

**解决了**：发送后无反馈。从 turn controller 的 `activeTurnId`
派生——活跃 turn 且时间线无 reasoning/tool 条目时显示脉动 "Deep diving…"。

**请验证**：指示器在所有场景下正确出现/消失——特别是不该出现的时机（tool 已在跑时、turn 已完成时）。

### 暗色模式手动切换（#89）

**解决了**：只有 `prefers-color-scheme` 无法手动切换。加了 sidebar
footer 循环按钮（System→Dark→Light），`data-theme`
属性覆盖 OS 媒体查询，persisted to localStorage。

**请验证**：三种模式切换后所有界面无布局破损；`data-theme` 与
`prefers-color-scheme` 交互无冲突。

### 可靠性大修（#87，由前一轮 agent 完成）

**解决了**：Settings chunk
503 卸载整个 app（SurfaceBoundary 隔离）；断线重连竞态；transcript
200 条截断（"Show earlier
messages" 展开已收数据）；IME/radio 焦点逃逸；跨会话晚到剪贴板结果。

**请验证**：`SurfaceBoundary` 是否正确隔离所有 lazy-loaded feature；history
expansion 是否保持滚动位置；`/copy` 的异步结果是否锁定到原会话。

### 行宽 + 复制清理（#90）

**解决了**：assistant 正文 65ch 上限；tool 空条目移除 "No output
yet"；空态文案去实现词汇。

## 已知边界（我们无法修的）

这些是 Core rc.9 限制，**不是前端 bug**——审计者不应视为 octoscode-web 缺陷：

1. 刷新杀死运行中 turn（Core 无 detached execution）
2. 无 post-turn release signal（owner socket 无法安全释放）
3. `session/list({cwd})` 可能误路由（octos#2146）
4. 新浏览器看不到已有 session（依赖 sessionStorage per-tab）

## 请你做的事

1. **零上下文使用 30 分钟**：连接 → 发消息 → 观察 timeline 全流程 → 切暗色/亮色 → 刷新恢复 → 手机宽度。记录任何你觉得不对的地方。
2. **代码审计**：重点看 `model.ts` 的 fold/sweep 函数（事件→条目的纯函数转换）和
   `SurfaceBoundary` 的错误隔离。
3. **协议审计**：`packages/client/src/wire-decoders.ts` +
   `projection.ts`——是否有输入空间未被覆盖。
4. **回答一个问题**：如果你要在 0.10 发布前再加一个修复，你会加什么？（只要一个）
