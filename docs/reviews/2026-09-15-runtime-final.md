# 2026-09-15 最后一轮运行时审计

本轮接续第二轮恢复修复，检查前后台 Session 所有权、异步响应、未知回合和 FIFO 队列。保留现有 Core 边界、懒加载解码器和同步 RPC 发送行为；没有修改或操作真实用户 Session，也没有部署。

## 已确认并修复

### P1：切换 Session 会丢失未知回合的唯一记录

第二轮修复保证 `unknown`
不会在当前页面自动重发，但导航存在旁路：已发送回合在重连 hydrate 中缺失，状态查询返回 unknown；若没有 pending，`openWorkspaceSession`
仍允许切换。candidate 提交调用 reset，删除了浏览器保存的未知回合。再次进入旧 Session 时 hydrate 依然不包含它，页面就失去限制重发的依据。

独立 Chromium
fixture 实际复现了这个流程。修复后，在导航入口、后台交接准备、最终 candidate 提交三个位置检查恢复状态。未知回合保留在当前 Session，提示先查询状态或通过 Settings 明确断开连接；草稿继续保留和可编辑。明确终态后即可正常新建 Session。发送中的导航排队、正常活动回合的后台交接没有改变。

- 实现：[use-octos-session.ts](../../apps/web/src/features/session/use-octos-session.ts)，`navigationBlockedByTurnRecovery`
  和 candidate 提交检查。
- 浏览器回归：[runtime-recovery.spec.ts](../../e2e/runtime-recovery.spec.ts)。旧实现失败，修复后通过；断言只有首次打开和重连两次 open、原回合只发送一次、草稿未丢失，明确 completed 后第三次 open 才发生。

### P1：已断开的连接仍可由晚响应提交认证或破坏下一次重连

RPC 响应已经收到后，类型解码仍可能等待按需加载模块。此时 socket 关闭无法再拒绝已经移出 pending 表的原始 RPC。旧运行时只比较 authority
generation/client，认证和 reconnect
open 仍可能在断线后提交：认证进入 authenticated 但没有任何可用 transport；Session 重连则替换 target，导致已经安排的重试发现 target 不同后退出。

现在认证 capability 响应、重连 capability 响应和重连 session/open 响应提交前都确认原 client 仍 connected。失效响应不会认证新身份，也不会改写重试目标或继续向死连接 hydrate。

- 实现：[active-session-runtime.ts](../../apps/web/src/features/session/active-session-runtime.ts)，`assertConnected`
  及三处提交检查。
- 回归：[active-session-runtime.test.ts](../../apps/web/src/features/session/active-session-runtime.test.ts)。两条失败测试分别复现认证误提交和晚 session/open 触发死连接 hydrate；修复后后一条同时验证下一次重连仍按计划完成并只发出一次 session-ready。

### P1：迟到的旧回合 terminal 会使 FIFO 越过另一个活动回合

hydrate 显示回合 B 活动，但没有旧回合 A 时，controller 保留 A 并查询 A 的状态。若 A 的 terminal 通知先于查询结果到达，旧
`settleTurn(A)`
会直接提升并发送本地排队消息，忽略已经确认仍运行的 B。此前只有状态查询终态分支正确处理 B，所以同样的生命周期结果因为到达渠道不同产生了不同执行顺序。

把“另一个 hydrate 活动回合优先于本地 FIFO”的逻辑移到共用 settlement 中。状态查询和 terminal 通知现在走同一规则：先观察 B，FIFO 顺序不变，B 终结后才发送下一条；A 的晚状态回包不能再次推进队列。

- 实现：[use-turn-controller.ts](../../apps/web/src/features/composer/use-turn-controller.ts)，`settleTurn`。
- 回归：[use-turn-controller.test.ts](../../apps/web/src/features/composer/use-turn-controller.test.ts)，旧 terminal 先于 lookup 的场景。旧实现失败，修复后验证 B 活动期间 start 仍为 1，B
  terminal 后精确增加到 2。

### P2：同一 client 重连后，旧 socket 回调可以污染新连接

`OctosUiClient.disconnect()`
先清空 socket 引用，但浏览器稍后才触发旧 socket 的 close。复用同一个 client 调用 connect 后，旧 close 原来仍会 reject 新连接的 pending
RPC 并更改状态；旧 error/message 也会发布到新连接的订阅者。当前 Web 活动运行时通常创建新 client，因此这是 client 复用边界的问题，不能表述成每次普通 Web 重连都会触发。

现在 open/error/close/message 都检查 socket 身份。旧 socket 仍可结束属于它自己的 connect
promise，但不能拒绝新 RPC、发布旧通知或改写新 transport 状态。取消中的旧 socket 即使迟到 open，也不能把尚在 connecting 的新连接标记为 connected。

- 实现：[client.ts](../../packages/client/src/client.ts)，WebSocket 回调身份检查。
- 回归：[client.test.ts](../../packages/client/tests/client.test.ts)，新增 6 项。close/error/message 及取消连接的旧 close 四项先于修复失败，所有新增场景现已通过。RPC 仍同步发送，响应校验仍按需加载。

## 验证

- Session/composer：18 文件、194 项测试通过。
- client：11 文件、83 项测试通过。
- 两个 TypeScript 项目通过，以上改动文件格式与 lint 通过。
- 新 Chromium 回归 1/1 通过，场景耗时 3.3 秒；隔离端口 54221/55221 已退出。
- 隔离 rc.9
  Core 集成门禁通过：协商、无 Profile 启动、Profile/catalog/test/save、精确 TUI
  Session open、hydrate、权限、监督和状态。命令为
  `OCTOS_BINARY=/home/shu/.octos/bin/octos node scripts/verify-core-integration.mjs`；脚本清理了临时状态。

异步响应和 FIFO 时序使用可控 promise 单元测试；unknown 导航使用真实 Chromium 操作和受控 WebSocket
fixture。上面的 Core 门禁不执行模型回合，不能把这些时序测试称为真实模型运行证据。全仓
`pnpm check`、完整浏览器和生产构建验证由本轮主审计统一执行，避免把这份局部结果冒充完整交付门禁。

## 保留的边界

跨刷新持续执行、完成 owner
socket 的安全释放、完整跨浏览器 Session 目录，仍依赖此前报告列出的 Core 契约。未知状态不会被解释成未执行；本轮明确保留导航限制，直到服务端状态可确认，或用户主动确认 Disconnect/Forget。没有新增自动重发、伪造终态或本地持久化任务状态。

## 整合期间补充：本地命令与响应模块边界

`/copy`
原异步回调持有旧会话的 setTimeline，却没有复核当前会话归属，切换后可能把 Copied 或 Copy
failed 写到新会话；clipboard
API 缺失还会在 Promise 链建立前同步抛错。将帮助、状态、复制和不支持命令的展示逻辑移到
[execute-local-command.ts](../../apps/web/src/features/commands/execute-local-command.ts)，所有入口、setTimeline 调用及 updater 内部检查调用方提供的身份验证，剪贴板成功和失败也检查。缺失 API、同步异常、异步拒绝都形成可见的 Copy
failed，不会升级成应用崩溃或被当作模型提示。

该模块只有展示数据和 setTimeline，没有 transport/RPC 方法；prompt 与 interrupt 仍由 App 同步分派。新增 12 项测试覆盖跨会话成功/失败、延迟模块调用、延迟 React
updater、缺失 API、同步异常、复制内容、能力筛选和 fail-closed 提示；类型和 lint 通过。

整合构建同时发现 Rolldown 将 `workspace-events.ts` 同步通知解码器及 generated
contract 常量合并进 workspace 响应块，导致初始模块为读取 token-cost 通知和方法名而拉入整个响应块。在既有
`protocol-values`
共享块中固定这两个共享依赖，保留原有同步通知、同步 RPC 发送及响应懒解码行为。独立构建确认 workspace 响应块不再出现在初始 preload；最终全仓产物数据以主审计报告为准，预算没有调整。

## 合并前复核：后台事件不能取消未知前台回合的状态查询

合并前独立复核发现 `confirmTurnAccepted` 在检查本地 dispatch
lease 之前清除了 recovery。因此重连后的观察连接收到同 turn 的 canonical
`tool_progress`
时，即便没有本地 dispatch 可承认，也会删除未知状态并取消准确的 lifecycle 查询。Core
rc.9 允许后台工具在前台 terminal 后继续输出，工具活动只能证明它仍有后台事件，不能证明前台回合仍处于 active。

新增 controller 回归实际得到
`confirmTurnAccepted = false`、checking 却变为 null；扩展现有 Chromium
unknown 导航用例后也复现 Check status 消失。修复将清恢复移到
`acceptLocalDispatch` 精确验证当前 client/session/turn
lease 成功之后、导航回调之前。真正的本地 start 承认仍能解除恢复并释放待导航，观察者或后台事件不会抹掉生命周期证据。

修复后 controller 与待导航测试共 57 项通过；Chromium 的未知回合、恢复释放待导航、恢复审批后台交接三项通过，类型和 lint 通过。浏览器使用受控 canonical 事件，合法后台工具事件的依据是固定 rc.9 源码及前轮报告；未把 fixture 复现表述成真实用户会话故障。此次没有发现其他新增的运行时合并阻断。
