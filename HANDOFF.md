# octoscode-web 全量审计 Handoff

> 复核说明：本文保留为历史交接记录。2026-09-14 的实测修复、交接事实更正和剩余风险见
> [产品审计报告](docs/reviews/2026-09-14-product-audit.md)与
> [第二轮恢复和交互修复](docs/reviews/2026-09-14-followup-audit.md)，最终状态见
> [2026-09-15 完整审计与修复](docs/reviews/2026-09-15-final-audit.md)；前端验收基线见
> [frontend-baseline.md](docs/frontend-baseline.md)。

> 2026-09-14 · 由 33 轮维护 session 的 AI
> agent（anantheparty）产出交接对象：全量审计专家立场声明：以下内容尽量诚实，包括我认为可能做错的部分。

---

## 1. 项目是什么

octoscode-web 是 Octos coding UI Protocol 的**浏览器客户端**——类似 Claude Code /
Cursor 的 Web 形态，但运行时真相（agent
loop、模型、工具、沙箱、审批、session）全部由本地 `octos serve`
拥有。浏览器**刻意不拥有**任何 agent 真相，这是产品架构的核心决策。

- monorepo：pnpm workspace
  - `apps/web` — React 19 前端（Vite + CSS Module + CSS 自定义属性）
  - `packages/client` — UI Protocol 的 TypeScript 客户端（无 React 依赖）
- 部署：nginx 静态服务 + `/api/` 反代到 core（127.0.0.1:18030）
- 自动更新：`octos-web-update.timer`（每分钟轮询 GitHub main → 构建 → 部署）

## 2. 当前状态（审计者应该知道的）

### 2.1 表面健康指标

| 指标        | 值                                      | 来源           |
| ----------- | --------------------------------------- | -------------- |
| PR 合并     | 31 个（#10–#77）                        | GitHub         |
| Open issues | 22 个                                   | GitHub         |
| 单元测试    | 269 web + 53 client，全绿               | CI             |
| CI          | check/contract/core-integration/e2e 4/4 | GitHub Actions |
| 部署        | HTTP 200，commit = main HEAD            | 18032          |

### 2.2 我做完后仍然担心的事（审计者重点看）

#### A. 核心协议依赖的脆弱性

octoscode-web 100% 依赖 `octos serve` 的 UI
Protocol（rc.9）。Core 有以下已知问题（README 明文记录），**前端完全无法绕过**：

1. **无 post-turn release
   signal**：turn 完成后 server 不通知，前端不知道何时可以安全释放 owner socket
2. **`session/list({cwd})`
   误路由**：unscoped/admin 连接下可能返回错误的 session 列表
3. **8 个 owner 连接上限**：无释放信号导致前端只能保守保留
4. **刷新杀死运行中 turn**：浏览器 WebSocket 断 → core 终止 turn，前端无能为力

这些限制了 #78（P1：刷新丢失对话）的修复——前端需要 Core 暴露 turn-status 查询端点才能根治。

#### B. 我加速交付时可能埋的坑

33 轮维护产出了 31 个 PR。速度快意味着：

1. **有些 PR 未经充分实战验证**——CI 过了（axe/视觉/LoAF/e2e），但真实用户场景没全覆盖。特别是 #71（timeline 重构）改了核心渲染路径，虽然 269 测试全绿，但仅用 fixture 验证过。
2. **视觉基线重新生成过两次**——每次"有意变化"都重新生成。审计者应检查：这些"有意变化"是否真的是改进，还是掩盖了回归。
3. **JS
   bundle 从 ~340KB 涨到 358KB**（预算从 350 上调到 352KB）——每次功能追加都在推高。预算棘轮本身是好的，但我上调它时应更保守。
4. **代码架构**：`App.tsx` ~1600 行、`use-octos-session.ts`
   ~1500 行。两代侦察兵独立指出这是 god-file（#58），我没拆——因为"拆分驱动力应是接线穿过单一闭包，而非文件大小"，但一直没时间做。

#### C. 测试覆盖的真实盲区

| 门禁            | 覆盖                       | 不覆盖                                   |
| --------------- | -------------------------- | ---------------------------------------- |
| 269 单元测试    | 折叠逻辑/选择策略/连接恢复 | 渲染正确性（SSR only，无 jsdom）         |
| axe 门禁        | WCAG A/AA 自动检查         | 语义正确性（虚拟读屏 only）              |
| 视觉基线        | 像素级回归                 | 基线是 CI 生成的（字体渲染差异已解决）   |
| LoAF 帧预算     | >200ms 长帧                | 交互延迟（INP）、内存泄漏                |
| e2e（fixture）  | 主流程 + 键盘行为          | **真实 Core 对接**（仅 1 个 261 行冒烟） |
| pre-commit 钩子 | main 直提 + 敏感信息       | 逻辑正确性                               |

**审计者应特别注意**：所有 e2e 门禁锚定在
`mock-ui-server.mjs`（1633 行手写 fixture）上。这个 fixture 是 Core
rc.9 语义的影子实现，其保真度靠文档散文维持。没有任何自动化手段检测 fixture 与真实 Core 的语义漂移。octos#2296 修了 core 侧 hydration 后，fixture 是否已经过时？**没人知道。**

#### D. 安全审计要点

- Auth token 通过 WebSocket query
  string 传输（浏览器限制），README 声明"避免打印或保留 URL"
- CSP `connect-src 'self'`
  强制走 nginx 代理（同源），这是正确的——但也意味着 CSP 配置错误会导致整个连接失败且难以诊断
- `beforeunload` 无处理器——刷新不警告
- `sessionStorage` 保存 session 引用（per-tab），`localStorage`
  保存连接偏好（跨 tab）——**无 token 持久化** ✓
- 预检脚本 `verify-repository-policy.mjs` 检查行数预算/内联样式/敏感信息

#### E. 我不确定的设计决策

1. **CSP
   `connect-src 'self'`**：安全正确，但导致 origin 必须填 18032 而非 18030——用户会困惑。考虑过改为显式允许
   `ws://127.0.0.1:18030`，但为了保持严格 CSP 而放弃。审计者评估这个权衡是否合理。
2. **视觉基线 CI 生成**：解决了本地/CI 字体漂移，但意味着基线更新依赖 CI
   dispatch——本地无法独立验证像素。
3. **`content-visibility: auto` + 负 margin**：导致 heading 裁剪（#75 修了），但类似问题可能在其他地方存在。
4. **reasoning 分段策略**：按 tool 边界分段。但如果模型在两次 tool 之间产生大量 reasoning，会创建多个小段——是否应该有最小段长度？

## 3. 架构关键文件

```
apps/web/src/
├── app/
│   ├── App.tsx              # 主 shell（~1600 行，god-file）
│   ├── AppProduct.module.css
│   ├── styles.css           # 全局样式（2876 行，有预算棘轮）
│   └── theme.css            # DSW token 定义（色彩/字体/间距/阴影）
├── features/
│   ├── timeline/            # 时间线（模型 + 渲染）
│   │   ├── model.ts         # 纯函数：事件流 → TimelineEntry[]
│   │   ├── Timeline.tsx     # 渲染组件（ReasoningBlock/ToolBlock/DefaultEntry）
│   │   └── Timeline.module.css
│   ├── session/             # 会话管理（runtime/connection/projection）
│   │   ├── use-octos-session.ts  # 核心状态 hook（~1500 行，god-file）
│   │   ├── background-turn-manager.ts  # 多 owner 连接管理
│   │   └── connection-lifecycle.ts     # 连接状态机
│   ├── composer/            # 输入区（turn-queue/intent/selection）
│   └── ...（共 23 个 feature 目录）
├── ui/                      # 共享 UI 组件（Icon/ModalSurface/OctopusLogo）
└── scripts/
    └── mock-ui-server.mjs   # e2e fixture（1633 行，影子实现）
packages/client/src/
├── client.ts                # WebSocket 客户端（642 行）
├── wire-decoders.ts         # 协议解码器（28 行）
└── projection.ts            # 事件投影
```

## 4. 22 个 open issues 的分类

| 分类         | issues                                                   | 说明                             |
| ------------ | -------------------------------------------------------- | -------------------------------- |
| **P1 bug**   | #78                                                      | 刷新丢 turn（需 Core 配合）      |
| **P2 bug**   | #79                                                      | 空 token 无校验/错误信息不可区分 |
| **产品方向** | #62 管理面、#56 跨 tab、#53 ViewTransition               | 侦察兵提案                       |
| **UX 增强**  | #54 dialog/popover、#64 diff shiki、#66 composer         | 侦察兵提案                       |
| **性能**     | #42 窗口化、#63 React Compiler                           | 待数据/评估                      |
| **测试**     | #55 fast-check、#65 mutation、#67 真 VO、#23             | 测试基建                         |
| **工程**     | #58 god-file 拆分、#69 issue gate                        | 重构/流程                        |
| **parity**   | #68 ANSI 渲染                                            | TUI 一致性                       |
| **blocked**  | #1 代码生成、#3 include 契约                             | 等 Core                          |
| **待定**     | #15 runtime 细节、#20 通知、#21 命令面板、#22 playground | 等 owner                         |

## 5. 部署与基础设施

```
GitHub main ──(octos-web-update.timer, 每分钟)──→ 构建 → /data/services/octos/current/
                                                      ↓
                                              nginx (127.0.0.1:18032)
                                                      ├── 静态文件 (/)
                                                      └── /api/ → 127.0.0.1:18030 (octos serve)
octos serve (18030)
  └── gateway (coding profile, port 9401)
```

- CSP 安全头由 nginx 配置 + 仓库 `deploy/nginx.conf` 双重维护
- 环境变量 `/etc/octos/octos.env`（当前为空，env 通过 systemd/启动脚本传递）
- watcher：`wake/watch-github.py`（每 5 分钟轮询 5 仓）
- 定时唤醒：`wake/octoscode-web-wake.sh`（每 5h 触发巡检）

## 6. 33 轮维护做了什么（时间线摘要）

| 阶段     | PR                                      | 主题                                                   |
| -------- | --------------------------------------- | ------------------------------------------------------ |
| 部署加固 | #10                                     | CSP/安全头/nginx                                       |
| 正确性   | #12/#13/#14/#29/#30/#32                 | 重连重折叠/hydrate session 验证/pending questions/流尾 |
| a11y     | #25/#28/#44/#48/#50                     | 12 findings 全修 + 键盘 e2e                            |
| 性能     | #46/#52                                 | memo 边界 + LoAF 门禁                                  |
| UX       | #31/#34/#37/#59/#61/#71/#72/#73/#74/#75 | 骨架/图标/间距/滚动/长高/折叠/动效/指示器              |
| 诊断     | #47/#49                                 | copy-diagnostics + runtime ring                        |
| 产品     | #51                                     | 深链接                                                 |
| 测试     | #36/#40/#45/#60                         | 视觉基线/虚拟读屏/fixture 修复/单元锁定                |

## 6.5 流式回合 UX 审计发现（2026-09-14，Playwright 实测，2 回合 + 高频采样）

由独立审计 subagent 在真实部署上执行（截图 + DOM 采样 +
settle 轮询 trace），产物在
`/tmp/ocw-audit/`（12 张截图、dom-*.json、settle-trace.json、timings.json）。

### P1（已立案）

| Issue | 问题                                                                               | 关键证据                             |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| #81   | reasoning 块间歇性永久卡在 "Thinking…"/live 态（turn 完成后 180s 不落定）          | settle-trace.json：120 个采样 live=1 |
| #82   | tool 完成后到作答前 **8.5s 零反馈死窗**（showThinking 条件在 tool 出现后永不触发） | probe2-samples.json 7135→15585ms     |
| #83   | 全新浏览器看不到服务端任何 session（durable 可恢复仅限同 tab）                     | 12-session-restore.png               |
| #78   | 运行中刷新：时间线清空 + 指示器丢失 + 后台完成不回填                               | 03a vs 03b 对比                      |

### P2（未立案，记录在案）

- 答案无逐字流式，~15.6s 一次性整块到达（可能是 server flush 粒度）
- 最终时间线残留展开的原始 tool 输出（700+ chars mono）与折叠卡片并存
- 空 assistant 条目渲染 "No output yet"
- assistant 正文行宽 ~100 chars（理想 45-75ch，736px 栏宽偏宽）
- tool 卡完成即瞬时折叠，running 态从未被看见
- 连接门 origin 预填硬编码 `:50080`（与实际部署不符）
- 运行中 Stop + 禁用排队箭头双 affordance 噪音
- 空态副文案泄露实现词汇 "durable projection events"

### 审计亮点（做得好的）

- composer 元信息透明度（权限/模型/上下文用量）是教科书级信任设计
- 连接门安全叙事完整
- 折叠卡密度控制 DSH 级
- 全程 0 console 错误
- 侧栏会话运行蓝点→结束灰点的环境状态表达

### 审计者应重点验证的间歇性 bug

Issue #81（reasoning 不落定）是**间歇性的**（1/2 复现）。修复方案（PR
#77）修正了 sweep 的 ID 匹配，但竞态可能出在 reasoning_delta 到达与 sweep 执行之间的时序窗口。审计者应：

1. 跑 10+ 回合验证复现率
2. 检查 `sweepTurnStreamtails` 是否应改为 turn-scoped 而非 ID-pattern-matched
3. 确认 `addSystemMessage` 是否会在 sweep 之后重新插入 running 条目

## 7. 我的自我评估（不客观，仅供参考）

### 做得还行的

- 正确性 bug 修复快（#12/#13/#32 当天修）
- 测试防线持续加厚（从 0 到 6 层）
- 文档维护（workflow/journal/tasks/benchmarks）
- 侦察审计体系（5 代 scout 独立验证了判断信度）

### 可能做错了的

- **产出太多、消化太少**：31 个 PR +
  22 个 issue，但用户最关心的**基础体验**（thinking 显示、tool 折叠、滚动）直到最后几轮才修——应该更早从审计转向执行
- **侦察过度**：5 代 scout 产出了大量提案，但提案≠改进。#53-#58、#62-#69 主要是"可以做的事"而非"必须做的事"
- **核心依赖风险应对不足**：Core
  rc.9 的限制（无释放信号/session 误路由）是最大的产品风险，我把精力花在了前端打磨上而不是推动 Core 解决上游问题
- **实战测试不足**：多次说"部署实测"但经常被 WebSocket 问题卡住，真正坐在浏览器前使用的时长太少

### 给审计者的建议

1. **先手动使用 30 分钟**：连接 → 建 workspace
   → 发 3 条消息 → 中途刷新 → 观察恢复。这比读代码更能发现问题。
2. **重点审 `model.ts`
   的 fold 函数**：这是整个时间线的核心逻辑，所有事件→条目的转换都在这里。
3. **对比 fixture 与真实 Core**：`mock-ui-server.mjs` 的行为语义 vs 真实
   `octos serve` 的行为——漂移是最大的隐形风险。
4. **跑一次 `pnpm check` + `pnpm test:e2e` +
   `pnpm test:e2e-live`**（需要真 Core）：确认所有门在当前 commit 上仍然绿。
5. **检查 GitHub issue
   #78**（P1 刷新丢失）的修复可行性——它需要 Core 配合还是纯前端可解？
