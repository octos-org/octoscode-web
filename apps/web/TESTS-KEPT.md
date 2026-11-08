# apps/web TESTS-KEPT

apps/web 单元测试的唯一保留清单（2026-11-07 起的测试瘦身做法：先定保留清单，清单外整批删）。下表列出的测试留下，**其余 apps/web 单元测试在下一个 PR 里整批删除**，连同只为它们服务的测试工具和 fixture。删除 PR 只核对两点：删掉的都不在清单上，清单上的都还在。

类别：1=跨系统，2=跨功能，3=安全边界，4=丢数据且端到端测不到的地方（恢复、数据完整性、并发、协议帧），5=有意的设计决定（附文档、issue 或 PR 链接）。

**第 1 类在 apps/web 一条也不留。**
跨系统主链（发消息到 Core 再回到网页、审批落地、断线恢复、协作者、定时任务）由
`e2e/` 和 `e2e-live/`
在真实浏览器里走，不在本清单范围内。apps/web 只留浏览器测不到或测不稳的东西：多个模块真实组装后的跨功能交互，以及安全、数据完整性和有意设计的少数几条。

## 基线与预计

- **当前**（main `7779b9f`，`wake/test-lines.py` 口径）：
  - 全仓 95,108 行 / 2,728 个；
  - 其中 apps/web 48,339 行 / 1,746 个（219 个文件）。
- **保留**：58 个测试，分布在 38 个文件里（T-0532 之后为 60 个，新增的 2 个都在
  `history/turn-undo.test.ts`）。每一条都对过
  `vitest list`：按文件和标题各命中一条，`it.each` 那条整张表算一条。
- **预计删后**：
  - 保留测试的函数体约 1,760 行。算上这 38 个文件现有的全部 import 和 harness，上限约 6,000 行；只为被删测试服务的 helper 会一起删，实际会落在两者之间。
  - apps/web 约 2,000–6,000 行，减少约 42,000–46,000 行。
  - 全仓相应降到约 49,000–53,000 行（其他目录不变时）。

## 2. 跨功能

| 测试（文件 › 标题）                                                                                                                                                                                                                                         | 类  | 守的是什么                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/session-record-concurrency.test.ts` › A blocked on a REAL approval while B/C drain exactly once; second starts gated on OBSERVED entry; selection switches never reset; foreign interrupt/decision and genuinely-stale cursor events stay isolated | 2   | 一个连接上三个会话：A 卡在真实审批时，B、C 的排队回合各发一次；切换选中不重置；外来的中断、决定和过期游标事件不串到别的会话（ADR 0020）       |
| `session/session-record-concurrency.test.ts` › RECONNECT with a pending interaction: canonical hydrate restores the blocked approval; enqueue stays blocked until resolution                                                                                | 2   | 断线重连 × 待审批：hydrate 恢复被卡住的审批，审批解决前不放行新回合（ADR 0005、0020）                                                         |
| `session/session-record-integration.test.ts` › freezes all records on loss, ignores old RPC rejection, and resumes A2 only after ready then A3 after A2 terminal                                                                                            | 2   | 断线 × 排队回合：断线时冻结所有会话，忽略旧连接上的 RPC 拒绝；连上并 ready 后才发 A2，A2 结束后才发 A3                                        |
| `history/history-coordinator.test.ts` › blocks active and queued work before sending any history RPC                                                                                                                                                        | 2   | 撤销/回滚 × 运行中和排队的回合：先挡住回合，再发任何历史 RPC                                                                                  |
| `cron/run-outcome.test.ts` › never takes a person's turn, even one right after a run that started none                                                                                                                                                      | 2   | 定时任务 × 用户回合：定时运行永远不认领用户自己发的回合                                                                                       |
| `media/attachment-drafts.test.ts` › consumes attachments only after successful local queue admission                                                                                                                                                        | 2   | 附件 × 发送队列：成功进入队列才消耗附件，被拒时附件仍在                                                                                       |
| `composer/use-turn-controller.test.ts` › adopts another client's live turn only when this app holds nothing for that session                                                                                                                                | 2   | 多客户端 × 回合归属：本页在该会话没有任何持有时，才接管别的客户端正在跑的回合（docs/protocol.md「Turn ownership during Session navigation」） |
| `review/native-review.test.ts` › shares the real record FIFO and drains ordinary prompts on review terminal                                                                                                                                                 | 2   | 原生 review × 普通提示：两者共用一个 FIFO，review 结束后才发排队的普通提示                                                                    |

## 3. 安全边界

| 测试（文件 › 标题）                                                                                                                  | 类  | 守的是什么                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------- |
| `connection/preferences.test.ts` › keeps only origin durably and scopes credentials plus session to the tab                          | 3   | 鉴权令牌不进 localStorage，只存在本标签页（CONTRIBUTING、ADR 0017）                |
| `connection/preferences.test.ts` › never remembers credentials pasted into an address or reconnects a replaced draft                 | 3   | 粘进地址里的凭据不会被记住，已被替换的连接草稿不会自动重连                         |
| `connection/pairing.test.ts` › refuses a non-loopback origin without making the request                                              | 3   | 配对码只发往本机回环地址，其他地址直接拒绝，请求不发出                             |
| `connection/pairing.test.ts` › bounds both values so a hostile address cannot be echoed whole                                        | 3   | 外部输入上限：恶意链接里的参数被截断，不会整段回显                                 |
| `error/FatalErrorBoundary.test.tsx` › redacts query and bearer credentials from diagnostics                                          | 3   | 崩溃诊断里的 query 凭据和 bearer 令牌被脱敏                                        |
| `models/model-settings.test.ts` › stops after a failed probe and redacts provider echoes                                             | 3   | 提供方错误里回显的 API key 被脱敏；连通测试失败就停，不保存                        |
| `markdown/MarkdownBody.test.tsx` › renders settled GFM and keeps raw HTML inert                                                      | 3   | 模型输出里的原始 HTML 不执行（ADR 0006）                                           |
| `markdown/MarkdownBody.test.tsx` › allows only absolute safe links                                                                   | 3   | 只放行安全的绝对链接，`javascript:` 之类的协议不放行（ADR 0006）                   |
| `connectors/connector-oauth.test.ts` › ignores another sign-in's return, and one from another origin                                 | 3   | OAuth 回跳要核对 state 和来源：别的登录、别的源发来的回跳都不认                    |
| `remote/remote-handoff.test.ts` › copies only the server and distinct folders, dropping all source URL credentials and session state | 3   | 手机接力只带服务器和文件夹，来源 URL 里的凭据和会话状态一律丢弃                    |
| `control/PeerControlPanel.test.tsx` › renders the admitted seat without sending a frame or disclosing the token                      | 3   | 控制席位的令牌不出现在页面上，渲染时不发帧                                         |
| `media/attachment-drafts.test.ts` › rejects wrong-profile, arbitrary-path and mismatched-size receipts without exposing errors       | 3   | 上传回执的 profile、路径、大小都必须对得上；任意路径被拒，错误细节不外露           |
| `side-panel/panel-selection.test.ts` › joins only an exact workspace-relative path, never a basename or another root                 | 3   | 侧栏读文件只拼精确的工作区相对路径，不会读到另一个根下的文件，也不会只按文件名匹配 |
| `session/session-interaction-ledger.test.ts` › resolve fails closed when the Session reconnected since observation                   | 3   | 审批决定只发给看到这个请求的那一代连接；重连后的旧决定不发，免得批到别的请求上     |
| `session/driver-discovery.test.ts` › rejects cursor loops and page/row/time budgets without truncation                               | 3   | 分页遇到游标循环、或超过页数/行数/时间预算时报错，不会悄悄截断                     |

## 4. 恢复、数据完整性、并发、协议帧

| 测试（文件 › 标题）                                                                                                                           | 类  | 守的是什么                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------- |
| `session/session-record-integration.test.ts` › retains a never-sent queue head through hydrate and starts it at ready                         | 4   | 还没发出的排队提示熬过重连 hydrate，ready 后再发，不丢                                                               |
| `session/session-record-integration.test.ts` › admits caller UUID once and folds optimistic, canonical echo, and legacy twins exactly once    | 4   | 一条用户消息只出现一次：乐观行、canonical 回显和旧版双份合并成一条                                                   |
| `history/history-coordinator.test.ts` › does not replay an ambiguous rollback, even on repeated confirm                                       | 4   | 回滚结果不明时不重放，重复点确认也不会回滚两次                                                                       |
| `history/turn-undo.test.ts` › an unanswered restore is unknown: refreshed, not replayed, not claimed                                          | 4   | 撤销请求没收到答复就按「未知」处理：只刷新状态，不重发，也不说成功                                                   |
| `history/turn-undo.test.ts` › an undo retried after a failure can be redone to the point Core reused                                          | 4   | 失败后重试撤销成功、Core 复用了失败那次的 pre-restore 点时仍能恢复撤销，恢复到的正是那个点（T-0532，真实 Core 复现） |
| `history/turn-undo.test.ts` › a reused point that is not a pre-restore one leaves redo unclear                                                | 4   | 复用的最新点不是 pre-restore 时不猜，恢复撤销仍判为不明（T-0532）                                                    |
| `composer/use-turn-controller.test.ts` › treats a start timeout as an unknown outcome instead of a rejection                                  | 4   | turn/start 超时算「未知」，不算「被拒」：不重发提示，也不丢掉它（docs/protocol.md）                                  |
| `composer/use-turn-controller.test.ts` › restores an interrupted prompt on its OWN session's terminal, never another session's                | 4   | 被中断的提示只还给它自己的会话                                                                                       |
| `composer/use-turn-controller.test.ts` › does not send interrupt while turn/start is still dispatching                                        | 4   | turn/start 还没被确认时不发中断                                                                                      |
| `session/background-turn-manager.test.ts` › does not let an old terminal mutate a newer same-Session turn                                     | 4   | 旧回合的结束事件不会改写同一会话里的新回合（ADR 0019）                                                               |
| `session/durable-session.test.ts` › fails closed on a per-thread sequence gap                                                                 | 4   | 帧序号出现缺口就失败关闭，转为重新 hydrate（ADR 0005）                                                               |
| `session/durable-session.test.ts` › accepts monotonic envelopes and rejects a replayed duplicate                                              | 4   | 单调递增的帧照收，重放来的重复帧拒收（ADR 0005）                                                                     |
| `session/durable-session.test.ts` › turns replay_lossy into an explicit recovery request                                                      | 4   | 收到 `replay_lossy` 就发起明确的恢复请求（ADR 0005）                                                                 |
| `session/durable-session.test.ts` › rejects cross-session and cross-topic contamination                                                       | 4   | 别的会话或别的 topic 的帧不会混进来（ADR 0005）                                                                      |
| `session/active-session-runtime.test.ts` › rehydrates after lossy replay before delivering further notifications                              | 4   | 有损重放之后先重新 hydrate，再继续投递通知（ADR 0005）                                                               |
| `session/active-session-runtime.test.ts` › fails closed on the 4097th recovery event                                                          | 4   | 恢复缓冲超过 4096 条事件就丢弃缓冲，从最后一个持久游标重连，不无限缓存，也不投递残缺事件（ADR 0005）                 |
| `session/active-session-runtime.test.ts` › fails closed when reconnect opens a different Session id                                           | 4   | 重连时打开的会话 id 不一致就失败关闭，不把别的会话当成这一个（ADR 0020）                                             |
| `timeline/canonical-hydrate.test.ts` › reconstructs event order without duplicating durable messages, reasoning, tools, or same-turn steers   | 4   | 刷新后用 Core 的 hydrate 重建对话：消息、推理、工具调用和同回合的插话都不重复、不乱序                                |
| `timeline/canonical-hydrate.test.ts` › restores an interrupted unpersisted prompt, partial answer, and error instead of an empty conversation | 4   | 刷新后，被中断回合里还没持久化的提示、半截回答和错误都还在，不会变成空对话                                           |
| `timeline/model.test.ts` › keeps the real Core persisted answer final when later-sequenced deltas arrive                                      | 4   | 已持久化的最终回答不会被晚到的 delta 改写                                                                            |
| `session/session-composer-drafts.test.ts` › keeps full returned drafts in order without replacing new images or another Session               | 4   | 发送失败退回的草稿完整、按序保留，不覆盖新加的图片，也不串到别的会话（ADR 0021）                                     |
| `session/session-draft-cache.test.ts` › refuses a new draft at its bound without evicting anyone’s unsent text                                | 4   | 草稿缓存满了就拒收新草稿，不挤掉已有的未发送文字（ADR 0021）                                                         |
| `session/tab-session-lock-core.test.ts` › becomes owner on a free lock, flips on steal, ignores stale release                                 | 4   | 跨标签页的会话锁：被别的标签页抢走时让出归属，过期的释放不算数（#56、#180）                                          |
| `supervision/model.test.ts` › uses UTF-8 byte offsets and fails closed on a live output gap                                                   | 4   | 任务输出流按 UTF-8 字节偏移拼接，遇到缺口就失败关闭，不拼出乱码或漏段                                                |
| `peers/peer-manager.test.ts` › surfaces rejected/ambiguous starts without retrying or issuing another UUID                                    | 4   | 协作者启动被拒或结果不明时不自动重试，也不换新 UUID；重试沿用原 UUID，Core 才能去重                                  |

## 5. 有意的设计决定

| 测试（文件 › 标题）                                                                                                   | 类  | 守的是什么                                                                                                            | 依据                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `app/strip-rank-4510.test.ts` › checks the foreign holder BEFORE the active turn                                      | 5   | 状态条第三段的优先级：外部持有者高于「回复中」                                                                        | 测试头注释；T-0492 把它作为源码契约保留下来（#406）                                      |
| `app/strip-rank-4510.test.ts` › still ranks waiting-approval/waiting-answer above the holder                          | 5   | 等审批、等回答又高于外部持有者                                                                                        | 同上                                                                                     |
| `app/no-model-setup-gate.test.ts` › does NOT route pre-session: advertised but never fetched (run 21 defect)          | 5   | 会话还没打开、模型列表还没拉取时，绝不跳到 Settings › Models                                                          | `features/connection/no-model-setup.ts` 文件头和测试头（run 21 事故）                    |
| `composer/intent.test.ts` › sends ordinary text and a path-leading line to the model as typed                         | 5   | 普通文字，包括以路径开头的一行，原样发给模型，不会被当作命令吞掉                                                      | docs/tui-command-coverage.md「Implemented native contracts and remaining syntax limits」 |
| `composer/turn-collision.test.ts` › turnCollisionFrom › %s（整张 `it.each` 表）                                       | 5   | 只有 Core 返回带协议 UUID 的 typed `turn_in_progress`，才算「别的客户端在跑回合」；靠报错文字或传输错误猜出来的都不算 | 测试头；docs/protocol.md「Turn ownership during Session navigation」                     |
| `composer-bar/draft-estimate.test.ts` › counts a quarter token per ASCII character and two thirds per other character | 5   | 发送前的 token 估算和 Core 的 `octos_llm::context::estimate_tokens` 用同一套算法                                      | #340；测试头                                                                             |
| `session/session-identity.test.ts` › binds a fresh intent to a profile-routable API identity                          | 5   | 新会话 id 绑成 `<profile>:api:web-<uuid>`，因为 Core 只靠 id 路由后续请求                                             | docs/protocol.md「Workspace launch and onboarding」；ADR 0010、0017                      |
| `session-config/seat-holder.test.ts` › a binding under THIS app's stable driver id is SELF, never foreign             | 5   | 席位由本页启动的协作者持有时，不显示「另一个应用正在使用」                                                            | 测试头（Round 4 B，walkthrough 4200d）                                                   |
| `autonomy/model.test.ts` › drops a stale update — a late pre-clear update cannot resurrect the goal                   | 5   | 目标清除之后，晚到的旧更新不能让它复活                                                                                | octos-org/octos#1959                                                                     |
| `preferences/zh-coverage.test.ts` › translates every literal t() key                                                  | 5   | 每个字面 `t()` 键都有中文译文                                                                                         | 测试头（audit W1/H2）；#275                                                              |
| `preferences/zh-coverage.test.ts` › routes accessible names, placeholders and tooltips through t()                    | 5   | 可访问名、占位符、提示文字都经过 `t()`                                                                                | 同上                                                                                     |
| `preferences/zh-coverage.test.ts` › routes visible text through t()                                                   | 5   | 可见文字都经过 `t()`                                                                                                  | 同上                                                                                     |

路径都相对 `apps/web/src/features/`，`app/` 开头的相对 `apps/web/src/`。
