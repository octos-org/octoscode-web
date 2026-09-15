# Codex 0.10：timeline fold / SurfaceBoundary 独立复核

日期：2026-09-15。前端基线：`f6065a5d532353e6437e60445545d7403e787e41`。先读
`AGENTS.md` 与
`docs/CODEX-010-BRIEFING.md`，未读旧审计报告，未修改产品源码，未访问 `.octos*`
用户文件。Core 协议证据使用 `packages/client/core-runtime.json` 固定的 rc.9
revision
`5ea987813de4fd2afdd1d78f2106ad2868f0d923`；本地 Core 工作树较新，因此涉及可达性的结论另用
`git show <revision>:<path>` 复核。

结论：reasoning 分段、终态 sweep、活动指示器与 Settings 故障隔离的当前实现通过本次验证。确认两个 P2 问题：实际 rc.9 工具历史无法进入现有去重分支；后台完成事件未使用 durable
identity / media。追加双窗口验证还确认一项 P2 阅读顺序问题：Core 迟发 user
root，旁观窗口按到达顺序呈现回答在前；这不归因于前端重排事件。只推荐一个发布前修复：**修复普通工具 hydrate 的身份关联，以 rc.9 不带
`message.turn_id` 的真实响应形状补回归验证。**

## 确认问题

### F1 · P2：正常 rc.9 工具 hydrate 会重复显示工具条目

已知状态：briefing 未列出该问题；本轮独立浏览器体验也观察到两个 `bash`
在刷新后变成两条 `Tool output` 加两条 `bash`。这里的纯函数反例独立重现同一机制。

位置：

- `apps/web/src/features/timeline/model.ts:42`、`:80`：hydrate 只从
  `message.turn_id` 建立条目 turn 归属，没有保留 `thread_id` 用于关联。
- `apps/web/src/features/timeline/model.ts:701`、`:708`：工具合并要求
  `entry.turnId === envelope.turn_id`。
- `apps/web/src/features/timeline/model.test.ts:674`、`:680`：现有成功合并测试人为给工具消息提供了
  `turn_id`。

Core rc.9 的 `crates/octos-cli/src/api/ui_protocol_transport.rs:22285` 明确构造
`turn_id: None`，并注释 Message 结构当前不带 typed turn ID；`:22286` 仍带
`thread_id`。因此这不是畸形输入，也不需要重复/乱序事件：合法的普通工具 hydrate 就无法满足前端合并条件。

最小复现：

```ts
timelineFromHydrate({
  session_id: "coding:local:main",
  cursor: { stream: "coding:local:main", seq: 100 },
  messages: [
    {
      seq: 1,
      role: "tool",
      content: "/workspace/project",
      message_id: "tool-message",
      thread_id: "thread-turn-1",
      persisted_at: "2026-09-15T00:00:00Z",
      media: [],
      // rc.9 不提供 turn_id。
    },
  ],
  turns: [
    {
      turn_id: "turn-1",
      thread_id: "thread-turn-1",
      state: "completed",
    },
  ],
  replayed_tool_envelopes: [
    {
      session_id: "coding:local:main",
      thread_id: "thread-turn-1",
      turn_id: "turn-1",
      seq: 1,
      payload: {
        type: "tool_start",
        data: { tool_call_id: "pwd-call", name: "bash" },
      },
    },
    {
      session_id: "coding:local:main",
      thread_id: "thread-turn-1",
      turn_id: "turn-1",
      seq: 2,
      payload: {
        type: "tool_end",
        data: {
          tool_call_id: "pwd-call",
          status: "complete",
          output_preview: "/workspace/project",
        },
      },
    },
  ],
});
```

完整可运行反例在
`/tmp/codex010-fold-boundary/model.audit.test.mjs:128`。结果得到
`hydrated:tool-message`（Tool output）与
`tool:pwd-call`（bash）两个工具条目，正文完全相同。这里特意使用完全相同的短正文，排除了 preview 截断、包装、多个候选等其他解释。

影响：刷新/恢复改变已完成对话的工具数量和排列；原始工具输出与重放卡片分离，用户可能以为工具重复执行。

**本次真实场景可以只靠已提供字段修复。** 主审计补充的脱敏 capture
`/tmp/codex010-fresh-browser/live-hydrate-tool-redacted.json` 与
`/tmp/codex010-fresh-browser/live-hydrate-identities.json` 显示：工具消息 seq
2/3 没有 turn ID，但带相同 thread ID；`hydrate.turns`
有唯一的对应 thread/turn 关系，两个 replay
tool_end 各自 output_preview 与相应 content 完全一致。保留
`message.thread_id`，仅通过唯一的 `hydrate.turns[].thread_id → turn_id`
映射补足 turn 归属，然后保留现有同 turn 内唯一候选约束，即可处理这一轮，不需要 Core 新增字段。
`/tmp/codex010-fold-boundary/captured-hydrate-proof.mjs`
使用这两份 capture 重建工具相关输入，验证原函数得到 4 个工具条目；只对输入补足上述唯一映射后得到 2 个，产品源码未改。

固定 rc.9 `ui_protocol_transport.rs:4139` 的 `pre_stamp_turn_thread_id`
给同一 turn 的 User/Assistant/Tool 行预写 thread ID，`:23810`
为 hydrate.turns 提供 thread/turn 关系，也支持此路径。但 thread/turn 并不是 tool-call
identity：同 turn 内两个完全相同结果仍有歧义，不能宣称仅凭这些字段就能恢复任意历史工具的一一对应关系。缺少/冲突映射或多个匹配候选应继续保留原始信息，不能删除 turn 约束后按全历史相同正文盲目合并。Core 没有工具消息
`tool_call_id`
是实现约束；前端在已能证明关联的真实响应上仍无法合并，则是本次确认的呈现问题。

### F2 · P2：后台完成重放重复正文，实时完成丢失附件

已知状态：briefing 未列出；没有查旧报告来判断是否曾有其他记录。

位置：`apps/web/src/features/timeline/model.ts:443` 至该分支结束。
`background/spawn_complete` 总是使用 `background:${task_id}` 新建条目，忽略
`data.message_id` 和 `data.media`。普通 `assistant_persisted` 分支在 `:361`
已有 durable ID 关联与 media 拼接，后台分支没有对应处理。

Core rc.9 证据：

- `crates/octos-core/src/ui_protocol.rs:2938`：hydrate 同时携带后台 replay，`message_id`
  对应 durable transcript，供客户端合并。
- 同文件 `:4118`：`BackgroundChildCompleted` 正式包含
  `message_id`、`content`、`media`。
- `crates/octos-cli/src/api/ui_protocol_tests.rs:22993`、`:23049`：Core 自身测试保留 transcript 与 replay，并确认相同 message
  ID。

最小复现：hydrate 的 assistant 消息使用
`message_id="background-message-1"`、`content="Research complete"`；同时 replay 合法
`background/spawn_complete`，携带相同 message ID、
`task_id="task-1"`、`media=["research/report.md"]`。

实际结果：

```text
hydrated:background-message-1  Background agent  Research complete + Attachment: research/report.md
background:task-1              Background agent  Research complete
```

若只接收实时后台完成 envelope，则只有第二行，附件路径不显示。完整可运行反例位于
`/tmp/codex010-fold-boundary/model.audit.test.mjs:113`、`:123`。这两个断言分别因
`2 !== 1` 和缺失 `Attachment: research/report.md`
失败。既没有假设任意重复投递，也没有依赖非标准 payload。

### F3 · P2：旁观窗口显示回答在提问之前；Core 迟发 user root，前端按到达顺序保留

已知状态：briefing 未列出；本轮双浏览器真实会话已重复观察，随后记录了无正文事件元数据。这是独立于 F1/F2 的实时呈现问题，不归入 hydrate 修复，也不改变本报告唯一发布前优先项。

主审计提供的 `/tmp/codex010-fresh-browser/observer-envelope-metadata.json`
显示，同一 turn/thread 的 canonical 事件按下列顺序到达，seq 连续递增：

```text
seq 1–17   reasoning_delta
seq 18–22  assistant_delta
seq 23     user_message
seq 24     assistant_persisted
seq 25     turn_terminal
```

旁观窗口没有本地 optimistic user，所以最终显示 assistant →
user；发送窗口正常显示 user →
assistant。**证据不支持前端把已收到的事件顺序打乱，也不支持网络乱序解释。**

前端原因可精确定位：

- `model.ts:343` 对 user_message 只调用 upsert；`:728`
  对首次出现的 ID 追加到数组末尾。
- `model.ts:352` 的 assistant
  delta 会先建立回答条目；同 segment 的 persisted 更新该原位置。
- `features/composer/use-turn-controller.ts:190` 在 startTurn
  RPC 前调用 addOptimisticUser，发送方因此预先有了正确位置。
- `Timeline.tsx:91` 按条目数组顺序渲染，没有另一层反转或排序。

Core 的规范表述与实现时序必须区分。固定 rc.9
`crates/octos-core/src/ui_protocol.rs:3797` 的旧 Payload 文档称每个 chat
turn 从一个 user_message
envelope 开始；这不能直接当作 v2 运行时先发 user 的保证。固定 rc.9 transport 在
`:31904` 至 await 完成后才处理 agent response， `:32138`
开始持久化 response.messages；commit observer `:4314`
才为落盘的 User 行发出 canonical user_message。assistant
delta 则从实时 progress 路径发出。真实日志证明当前实现确实允许这次“回答流先到，user
root 后到”，与“user envelope 必先到”的阅读假设不一致。

最小模型复现：以连续 seq 依次输入 `assistant_delta(answer)` →
`user_message(question)` → 同 segment `assistant_persisted(answer)` →
`turn_terminal`。所有事件先经过 DurableSessionProjection，均被 apply。空初始数组最终为
`[assistant, user]`；只在初始数组放入发送方 optimistic user，最终为
`[user, assistant]`。完整验证
`/tmp/codex010-fold-boundary/observer-order.audit.test.mjs`
有两个断言：发送方通过，旁观方期望顺序失败。

判定：这是 **Core 迟发 user
root 暴露的产品阅读顺序缺陷**；前端忠实保留到达顺序，不应写成“前端重排错乱”。后续可以单独讨论同 turn 的 user 显示位置归一，以及 Core 是否提前发出 root；这不是本轮 hydrate 身份修复的一部分。这里只记录，不实施额外产品修改。

## fold、分段与活动状态验证

当前源码已超出 briefing 的旧描述：

- `Timeline.tsx:118`、`:142`：reasoning/tool 使用读者控制的 native
  details，默认收起；完成不会强制关闭已展开内容。
- `model.ts:126`：原 Deep diving 单一指示器已变为 `timelineActivity`。
- `Timeline.tsx:169`：当前直接呈现收到的工具正文，没有前端 500 字截断。

| 检查                | 结论与复现                                                                                                                                                         | 代码位置                                        | 严重性 / 已知状态                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| reasoning 工具边界  | reasoning → tool A → reasoning → tool B → reasoning，得到 `:0/:1/:2`，另一 turn 保持独立 `:0`                                                                      | `model.ts:383`, `:468`                          | 通过；briefing 所述已修复项                           |
| 终态全部分段        | 对 32 个工具边界，分别发送 completed / errored / interrupted / rate_limited；目标 turn 不再有 running，其他 turn 对象保持原样                                      | `model.ts:513`, `:588`                          | 通过；增加第四种合法 Core terminal outcome 覆盖       |
| 终态晚到正文        | terminal 后 assistant/reasoning delta 不重新激活前台；再次相同 terminal 不改变结果                                                                                 | `model.ts:334`, `:564`                          | 通过；已有回归保护                                    |
| 后台工具继续        | tool_start → terminal → progress → end 保留后台进展与最终输出；terminal 后新工具状态为 Background，活动指示器不复活                                                | `model.ts:620`, `:640`, `:657`                  | 通过；协议允许，不应丢弃所有 terminal 后事件          |
| 无 start 的工具结果 | tool_end 可重建结果，晚到 start/progress 不覆盖最终正文                                                                                                            | `model.ts:624`, `:646`, `:657`                  | 通过；现有回归保护                                    |
| 重复与乱序          | live duplicate 被 integrity guard 丢弃；seq gap 触发恢复而非直接拼接；hydrate 工具 replay 先排序后 fold                                                            | `durable-session.ts:138`, `:153`; `model.ts:85` | 通过；裸 fold 本身不是去重协议边界                    |
| sweep 去重范围      | 与最终 answer 相同的 reasoning `42` 保留；重复 assistant 尾部删除；输入对象不被原地修改                                                                            | `model.ts:518`, `:539`                          | 通过；避免把 reasoning 当答案尾部删掉                 |
| 活动指示器          | 无内容 Working；reasoning Thinking；运行工具优先 Running；工具结束后的间隙 Preparing next step；assistant Writing；终态/null turn 均无指示器；其他 turn 工具无影响 | `model.ts:130`; `App.tsx:419`, `:1073`          | 通过；approval/question/recovery 时 UI 有明确抑制条件 |

最小序列和断言见
`/tmp/codex010-fold-boundary/model.audit.test.mjs`。现有十轮浏览器测试还验证 Enter/Space 展开、完成后保持展开、跨 turn、空 assistant 不渲染以及 reduced-motion 状态。

输入空间边界需明确区分：

- `parseProjectionEnvelope` 对部分 ID 只验证 string 类型，空 turn/segment/tool
  ID、拼接字符串碰撞等可以人工喂给裸 fold；但本次没有证明正常 rc.9 发送路径生成它们，不把这类防御性输入提升为发布缺陷。
- 空/空白/非 string `tool_end.tool_call_id` 被 `model.ts:665` 拒绝，已单独验证。
- 相同 tool ID 跨 turn 会共享现有 `tool:${id}`
  key；Core 的原生/合成工具 ID 唯一性约定与前端相同。rc.9
  `agent/streaming.rs:15`
  明确要求合成 ID 全进程唯一，本次不以人为复用 ID 判定可达缺陷。
- 单独调用 fold 两次当然会重复追加 delta；真实调用链先经
  `active-session-runtime.ts:959` /
  `DurableSessionProjection`，已有测试证明 duplicate 未进入 fold。不能省略这个前提构造缺陷。
- 保守工具合并遇到多个相同输出候选时保留原始条目是安全选择；F1 的反例只有一个候选，并且提供相同 thread，因此不是这一有意保守策略。

## SurfaceBoundary：隔离正确，恢复范围有明确限制

`SurfaceBoundary.tsx:18` 的 failed 状态不会自动复位；`:64` 明示需 Reload
app，并提示运行任务、草稿和队列的影响。因此“关闭后其他功能可继续”与“同一个失败 chunk 可在页内重试”是两个不同能力。本次没有发现一次 feature
lazy import 失败导致 session owner 卸载的可达路径。

| lazy feature                                                                              | 捕获边界                                                                           | 复核方式 / 结果                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SavedSessionLinkPanel                                                                     | `App.tsx:611`                                                                      | 源码追踪，局部 surface                                                                                                                                                    |
| SessionSidebar                                                                            | `App.tsx:830`                                                                      | 源码追踪；会话 hook 在边界上方                                                                                                                                            |
| LaunchDecisionPanel                                                                       | `App.tsx:971`                                                                      | 源码追踪，局部 surface                                                                                                                                                    |
| NewSessionWorkspacePicker                                                                 | `App.tsx:995`, `:1304`                                                             | hero 与 dialog 两个入口均覆盖；dialog 可取消                                                                                                                              |
| SessionTrajectory                                                                         | `App.tsx:1037`                                                                     | 源码追踪，局部 surface                                                                                                                                                    |
| Timeline                                                                                  | `App.tsx:1050`                                                                     | 按 activeSessionKey 重置边界                                                                                                                                              |
| TurnRecoveryNotice                                                                        | `App.tsx:1062`                                                                     | 源码追踪，局部 surface                                                                                                                                                    |
| ApprovalPanel / UserQuestionPanel                                                         | `App.tsx:1154`, `:1176`                                                            | 按 approval/question ID 重置，失败 fallback 保留 Stop action                                                                                                              |
| PromptComposer                                                                            | `App.tsx:1202`                                                                     | 按 activeSessionKey 重置，fallback 保留 Stop action                                                                                                                       |
| SessionControlBar                                                                         | `App.tsx:1257`                                                                     | 在 composer 内有独立边界                                                                                                                                                  |
| SettingsDialog / GeneralSettingsContent / ModelsSettingsContent / ModelManagementSettings | `App.tsx:1339`                                                                     | 同一个 Settings 边界；顶层 Settings 与嵌套 GeneralSettingsContent 503 均实测隔离                                                                                          |
| LeaveConnectionDialog / DiffReviewDialog / TaskDetailDialog                               | `App.tsx:1454`, `:1474`, `:1487`                                                   | 均可关闭；DiffReviewDialog 503 实测焦点回到原 approval                                                                                                                    |
| MarkdownBody / CodeBlock                                                                  | `Timeline.tsx:215`, `MarkdownBody.tsx:69` 的 Suspense 外围是 Conversation boundary | CodeBlock 503 实测：整个 transcript 消失，composer/draft/owner/Stop 保留。不是每条消息各自隔离                                                                            |
| NavigationSurface 内 lazy ModalSurface                                                    | `NavigationSurface.tsx:4`, `:22`，导航子树边界位于其内部                           | 源码看似无外层错误边界，但同模块由 `SurfaceBoundary.tsx:2` 静态导入。当前构建入口也静态 import ModalSurface，不能把“已启动后首次打开导航才 chunk 503”当作真实惰性加载路径 |

新增浏览器验证 `/tmp/codex010-fold-boundary/boundary.audit.spec.mjs`：

1. 先显示普通 assistant，再对 CodeBlock
   import 注入 503：原答案从 DOM 消失，Conversation
   unavailable 显示，WebSocket 没有关闭，草稿保持，Stop 仍能发送 interrupt。
2. 移除 503 并 Chat → Trajectory → Chat：Conversation
   boundary 已重挂载，但 React.lazy 的 rejected
   import 仍缓存，没有再次请求模块；依然显示错误。
3. 对 GeneralSettingsContent 注入 503：只有 Settings
   unavailable；关闭后草稿和焦点恢复。移除 503 并重开 Settings 也不会重试旧 lazy
   promise。

上述三点由两个 Playwright 测试通过。它们确认已承诺的隔离，并记录恢复限制；不把需要 reload 重新报为新 bug。
`state.failed` 跨会话方面：Conversation/Composer 已带 session
key，交互面板带 interaction
key；全局导航是同一 feature，保留失败状态符合当前 reload 恢复策略。未构造真实数据渲染异常来证明其他固定边界会错误污染新会话，因此不报告推测性问题。

## 执行记录

所有 Node/pnpm 命令使用
`PATH=/opt/dsh/npm/bin:$PATH`；浏览器测试独立端口 fixture 50180 / Vite 4273。

- 现有 Vitest：`model.test.ts`、`Timeline.test.tsx`、`durable-session.test.ts`，**41/41 通过**。
- 现有 Playwright：`surface-recovery.spec.ts`、`timeline-interactions.spec.ts`，**6/6 通过**，含十轮流式交互。
- 临时 Node 验证：**13 项，10 通过、3 个期望断言失败**；三个失败分别对应 F1 工具重复、F2 后台重复、F2 附件丢失。日志
  `/tmp/codex010-fold-boundary/model-results.txt`。
- 临时 Playwright：**2/2 通过**。日志
  `/tmp/codex010-fold-boundary/boundary-results.txt`。
- 追加 observer 顺序验证：**2 项，发送方 1 项通过、旁观方 1 个期望断言失败**。日志
  `/tmp/codex010-fold-boundary/observer-order-results.txt`。基于真实连续 seq 元数据，不属于裸 fold 任意乱序攻击。

运行临时验证：

```sh
PATH=/opt/dsh/npm/bin:$PATH node --test /tmp/codex010-fold-boundary/model.audit.test.mjs
PATH=/opt/dsh/npm/bin:$PATH pnpm exec playwright test --config=/tmp/codex010-fold-boundary/playwright.config.mjs
```

本子任务未运行完整
`pnpm check`，未重复主审计的生产构建、主题、CLS、Firefox/WebKit 验证。本文件只记录验证与修复建议，没有实施产品修改或提交。

## 主审计补充：fold 的严格纯度边界

canonical 分段与 sweep 的验证不等于整个 `foldNotification`
严格纯。`model.ts:181` 和 `:271` 仍以 `Date.now()` 构造无效 projection /
warning 的条目 ID。确定性探针 `/tmp/octos-codex010/fold-purity.mjs`
证明：同输入在时间123/124返回不同ID；同一毫秒连续两个 warning 被同ID
upsert为一条，第一条被覆盖。原输入数组未被修改。

这是 P3 标识生成与可复现性问题；探针使用固定时钟，没有声称已在真实 Core 连发警告中观察到丢失。无效 projection 通常先被 durable-session 门拦截；warning 不在 canonical模式忽略的 legacy
methods集合中。若目标是严格纯转换，应由调用方提供事件身份/时间，而不是让 reducer自行读取墙钟。此补充不改变唯一发布前优先项。
