# 2026-09-14 Session、连接恢复与队列审计

审计范围：浏览器连接状态机、前后台 turn 所有权、排队消息、刷新恢复、Session 发现，以及真实 Core 集成检查。与本次视觉和时间线审计并行开展。

## 证据边界

- 实际服务配置指向 `/home/shu/.octos/bin/octos`。只读执行 `--version` 得到
  `octos 2.0.3-rc.9 (5ea9878 2026-08-23)`，与
  [core-runtime.json](../../packages/client/core-runtime.json) 的固定版本相符。
- Core 关键行为用本地 Git 对象 `5ea987813de4fd2afdd1d78f2106ad2868f0d923`
  核查。本地 Core 工作树 HEAD 为
  `d5ed7a9b`，包含后续改动，不能直接代表运行中的版本。
- 本轮没有发送真实模型请求，没有修改线上服务或用户会话。真实 Core 检查在临时目录和随机本机端口运行，使用脚本自带 provider
  fixture。
- 下述浏览器逻辑问题由源码与回归测试确认；不将这些单元测试表述成真实网络环境的浏览器复现。

## 已修复的问题

### P1：WebSocket 出错后不再自动恢复

[client.ts](../../packages/client/src/client.ts) 的 WebSocket `onerror`
将状态设为 `error`；后续 `onclose` 保留该状态。原
[active-session-runtime.ts](../../apps/web/src/features/session/active-session-runtime.ts)
的状态订阅只在 `disconnected`
时安排重连。因此已经认证、正常使用中的连接遇到浏览器的 `error → close`
序列，会停留在错误态，恢复机制根本不启动。

修复：`error` 和 `disconnected` 均进入现有重连计划。认证前的失败仍受
`retryEnabled`
控制，不自动循环连接。补充测试验证错误态恢复仍携带原 Session、Profile、Workspace 和 durable
cursor；初次连接失败不安排重试。错误态回归在旧实现失败，修复后通过。

### P1：恢复期间提升的排队消息永久卡住

原
[use-turn-controller.ts](../../apps/web/src/features/composer/use-turn-controller.ts)
在前一回合结束或开始请求被拒绝时，立即将下一条排队消息提升为 active。如果此时正在重连或 hydrate，`canStart()`
为 false，`startTurn()`
直接返回。该消息实际上从未发给 Core，hydrate 不可能包含它；原恢复逻辑又没有识别这种未发送的 active，导致它一直占着队列，后续消息也无法运行。

修复：记录被恢复过程暂停的未发送消息。hydrate 确认没有活动回合时，将它交给
`session-ready`
继续发送；如果 hydrate 发现丢失 ACK 的上一回合仍在运行，则将未发送消息放回 FIFO 首位，等待服务端回合结束。不会把未发送消息推断为服务端失败，也不会抢发第二个回合。

两条回归测试分别覆盖以上路径，均先在旧代码失败，再于修复后通过。

### P2：后台任务断线后失败状态消失

原
[background-turn-manager.ts](../../apps/web/src/features/session/background-turn-manager.ts)
对准备交接时的断线保留失败记录，但对已经 parked、或正在 reclaim 的 owner 断线直接删除。用户看到的运行标记因此无声消失。

修复：未观察到 terminal 的后台 owner 断线后保留 `failed`
记录，与已有交接失败语义一致。记录最多 8 条，已断开的记录不占 live
transport 配额，不能被 reclaim；已经完成的 socket 仍遵循原生命周期规则。本轮没有用延时或 terminal 推断安全释放时机。

测试覆盖后台 error、等待用户输入时断线、reclaim 期间断线，以及记录数量和 live 配额相互独立。

### P2：排队消息缺少取消入口所需的操作

排队消息属于浏览器，原队列只支持追加、逐条运行和整体清空。与此同时，存在 pending 会禁止切换 Session；停止当前回合还会继续发送下一条。原来的“停止排队后再切换”提示没有对应操作。

新增
`conversation.cancelQueuedPrompt(turnId)`，只移除尚未发送的 pending 消息，保留其余 FIFO 顺序；它不会取消 active
turn，也不发送 RPC。由 App 的排队列表提供入口。队列与 controller 测试验证了删除范围及没有额外 start/interrupt 请求。

## 集成交叉审查发现并修复的回归

### P2：前台终态屏障误删合法后台工具事件

交叉审查发现，新时间线终态屏障把同一 turn 的 `tool_start` 和 `tool_progress`
也当作迟到文本丢弃。rc.9 在 `spawn_only`
工具触发后，会在前台 terminal 之后继续转发后台工具事件，并沿用原 turn
context；其 `drain_should_skip_event` 只过滤
`done/error/token/reasoning_chunk`。因此
`turn_terminal → tool_start → tool_progress → tool_end`
是需要保留的合法序列。原改动丢弃 start 后，end 也因找不到卡片而丢失，最终结果只剩 terminal。

修复后，终态后的工具卡和进度仍保留，标为
`Background`，不恢复前台 running 或活动指示。具有明确服务端 `tool_call_id`
的单独 tool end 也会保留为结果卡；没有 call
identity 时不创建猜测条目。已收到 end 的输出不会被迟到的 start/progress 覆盖。回归测试覆盖 canonical 与 legacy 序列、前台终态之前已经启动的后台工具，以及缺失 start 的最终结果。

### P2：展开工具详情触发自动跟随，裁掉所点击的标题

新滚动 hook 的 ResizeObserver 起初把用户展开 disclosure 也视为需要跟随的内容增长。使用已有 Vite 和模拟服务、独立 Chromium 页面复现：1280×800 视口，滚动容器顶部为 52px；展开前工具标题 top=70px、scrollTop=679，展开后 top=43px、scrollTop=706，标题被容器裁切。临时抑制 ResizeObserver 的同场景对照没有该位移。

App/scroll
hook 随后增加展开前的用户操作检测，先暂停跟随。原脚本复测：展开前后 scrollTop 均为 679，标题 top 均为 70px，标题始终完整可见。原复现及对照脚本保存在
`/tmp/octos-scroll-review.cjs`。本验证只使用模拟协议，没有运行真实模型任务。

## HANDOFF 中需要更正的判断

| 原判断                                | 本次核查                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| “Core 有 8 个 owner 连接上限”         | `MAX_BACKGROUND_TURN_TRANSPORTS = 8` 是 Web 自设的保留配额。上游缺少可证明安全释放的生命周期契约，是这个前端限制的原因；8 并非这里查到的 Core 硬上限。                                                             |
| “需要 Core 暴露 turn-status 查询端点” | rc.9 已实现 `turn/state/get`，对应 feature 为 `state.turn_state_get.v1`，Web 生成契约也已有常量。当前 Web 没有协商或封装这个查询。它可辅助活动状态恢复，但不等于 post-turn quiesced 信号。                         |
| “刷新问题前端完全无法处理”            | 断开 owner socket 会终止运行中的 turn，这一点成立。rc.9 同时会追加 durable `turn/error(connection_closed)`。避免无提示离开、明确展示中断、正确恢复已提交记录仍属于前端责任；不能把时间线变空都归结为缺少状态查询。 |
| “新浏览器看不到历史只是 Core 的问题”  | [preferences.ts](../../apps/web/src/features/connection/preferences.ts) 只从当前 tab 的 Session 引用缓存加载侧栏；前端没有使用已有的 `listSessions()`。这是明确的产品取舍，同时受下面的真实 Core 路由问题约束。    |

Core rc.9 的对应源码位置为
`crates/octos-cli/src/api/ui_protocol_transport.rs`：`handle_turn_state_get`
约 22872 行，`resolve_session_list_cwd_root`
约 24102 行，`abort_connection_turns` 约 35175 行。这些行号对应上述固定 Git
revision，不能套用到较新的工作树。

## 仍需上游或后续交付解决的边界

1. **跨刷新持续运行**：owner
   socket 关闭仍会 abort 服务端 turn。要保证刷新、关闭标签页或网络断开后继续执行，需要 Core 的 detached
   execution/重新附着契约；前端不能靠保留或伪造活动状态解决。
2. **安全释放完成的 owner**：terminal 通知之后仍可能有清理和记账工作，且旧连接关闭会执行 Session
   scope cleanup。不能将 `turn/state/get = completed`
   当成 socket 可释放的证明。本轮保留原 8 个后台 transport 的限制。
3. **完整 Session 发现**：rc.9 的 WS `connection_profile_id`
   在 upgrade 时冻结。admin/unscoped 连接为 `None`，后续
   `session/open(profile_id)` 不改变这个身份；`session/list({cwd})`
   据此选择 Profile store，结果又没有 Workspace/Profile 的完整证明。简单把
   `listSessions()` 接到侧栏会冒错分组风险。需要可靠的 scoped
   list/SessionRef 契约，或单独设计、验证适用范围有限的导入流程。
4. **已接受回合在 hydrate 中完全缺失**：原 controller 对未知或缺失的已发送 active 仍保守等待。这与本轮修复的“从未发出的排队消息”不同，不能宣称请求没有执行。需要通过已存在的 turn 状态查询、明确的未知状态展示和恢复操作收敛；本次没有将它作为已复现的部署故障，也没有加入猜测性自动重发。

## 验证结果与门禁盲区

- Session/composer：15 个测试文件，145 项测试通过。
- 集成交叉审查修复后的 timeline：2 个测试文件，32 项测试通过。
- Web TypeScript 检查通过；本轮修改的运行时代码格式和 lint 检查通过。
- 真实 Core 门禁运行命令：`OCTOS_BINARY=/home/shu/.octos/bin/octos node scripts/verify-core-integration.mjs`。沙箱内首次因本机监听
  `EPERM` 失败，按授权使用隔离检查所需的执行权限重跑后通过。
- 实际成功输出：`Verified v2.0.3-rc.9 (5ea9878) through real octos serve: health, negotiation, no-profile launch, profile/catalog/test/save, exact TUI session open, hydrate, permissions, supervision and status.`
  临时 Core 已退出，脚本成功清理了其临时状态。
- 此集成脚本**没有执行 turn/start**，hydrate 测的是新建空会话。因此门禁通过不证明流式输出、活动回合刷新、后台 owner 或排队恢复可用。脚本在自己的协商配置下报告 forward
  methods 未 advertised，也不能据此断言所有方法在所有连接配置下都不存在。
- [e2e-live/glm-model.spec.ts](../../e2e-live/glm-model.spec.ts)
  目前有真实回合结束后刷新和后台运行场景，但刷新发生在结果出现之后，不覆盖活动回合刷新。相关 controller 测试使用 SSR
  hook harness，本轮增加了 admission
  gate 可变的情形；视觉、按钮状态和实际浏览器事件仍需要 Playwright 验证。

未修改 Core、部署配置或固定版本，未 commit 或 push。
