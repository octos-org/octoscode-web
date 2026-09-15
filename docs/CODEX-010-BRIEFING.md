# Codex 0.10 发布协作 Briefing

> 2026-09-15
> · 给 Codex 的 0.10 发布冲刺任务书你的任务：高强度验证 + 测试 + 修复细节问题我们的分工：你修 bug，我跑审计 subagent 并提交发现

---

## 当前状态

- main = `949d521` + PR #89（theme toggle）待合
- 466 单元 + 97 e2e，全绿
- JS 预算 353KB（余量 ~2.2KB）
- 21 open issues（含 #78 P1 刷新丢 turn、#83 P1 新浏览器无 session）

## 你的任务

### 1. CLS / Layout shift 修复

用户反馈"各种界面加载时大小和实际大小不一样很难受"。具体来源：

- `DeferredSurface` fallback 无尺寸预留
- `contain-intrinsic-size: auto 120px` 可能不匹配实际条目高度
- `<details>` 展开/收起时周围元素跳动
- lazy-loaded chunk 到达时 DOM 结构变化

修法方向：给 Suspense fallback 加正确的 `min-height`；用
`content-visibility: auto` 的 `contain-intrinsic-size` 调到实测值；`<details>`
用 CSS `interpolate-size` 平滑过渡。

### 2. 细节问题清单

我们的审计 subagent 正在跑，产出会追加到本文件下方。已知问题：

- origin 预填硬编码 `:50080`（应默认空或用 `window.location.origin`）
- assistant 行宽 ~100ch（应限制在 65-75ch）
- 空 assistant 条目渲染 "No output yet"
- "Turn complete" + "completed" 语义重复
- Stop + 禁用箭头双 affordance
- 空态文案泄露 "durable projection events" 实现词汇

### 3. 发布阻塞标准

以下必须全绿才能发 0.10：

- `pnpm check` 全过
- `pnpm test:e2e` 全过
- CLS < 0.1（用 PerformanceObserver layout-shift 测量）
- 暗色/亮色/系统三种模式无布局破损
- 320px 手机宽度无水平溢出
- 键盘 Tab 全可达

### 4. 注意事项

- `pnpm check` 里的 styles.css 行数预算是 2877，新样式放 CSS Module
- JS 预算 353KB，不要上调——用 lazy loading 解决
- 不要动 `packages/client`（除非协议变更）
- 不要改 `deploy/nginx.conf`（CSP 是安全边界）
- 视觉基线重生成走 CI dispatch（`workflow_dispatch` +
  `update_visual_snapshots=true`）

## 审计发现（追加区）

（审计 subagent 产出后追加到这里）
