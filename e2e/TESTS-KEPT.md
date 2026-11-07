# e2e 保留清单（T-0500，shu 11-07 新法）

本清单是 e2e 目录的**唯一保留清单**，为 T-0501 整批删除定边界。**不在清单内的测试默认后续全删**，不逐条写删除理由。

判定依据 `wake/lanes/TEST-DIET.md` 第 1–5 类：

- **① 跨系统链路**：真实 Chromium + mock 服务器 + WS 的用户可感知主流程。
- **② 跨功能**：两个功能互相影响（如撤销×产物、中断×工具、队列×会话切换）。
- **③ 安全边界**：每类只留一两个（来源校验、凭据范围/脱敏、权限、fail-closed）。
- **④ 并发 / 数据完整性 / 恢复**：帧级正确性、断线/刷新恢复、出错不丢数据，每类留最关键的。
- **⑤ 有意设计例外**：改之前要二次思考的设计决定，能链接处已链接。

规则补充：同一守卫的参数变体（换会话、换视口、换命令）只留最有代表性的一个；桌面/手机、故障恢复、身份/目录隔离等**独有边界**不得漏；不以 mock 结构代替真实状态。

## 基线与预计

- 基线（origin/main
  `2e80cbe`，`python3 wake/test-lines.py`）：全仓 95,108 行测试 / 2,728 个；e2e
  **32,482 行 / 487 个**（全仓第二大目录）。
- 本清单保留
  **117 个测试**（按文件条目计；forEach/it.each 展开数以一条目代表一条守卫）。预计保留范围：e2e 约
  **1.4–1.6 万行**（47% 的测试守卫绝大多数行数在 soak/product 大文件里，删除的多为小测试，行数比例低于测试数比例）。T-0501 执行后实测回填。

## 保留清单

### attention.spec.ts（留 2/4）

| 测试                                                                                         | 类  | 守的链路                                           |
| -------------------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| a background Session completing while another is selected signals and acknowledges on return | ②   | 跨会话注意力信号与确认（后台完成 → 选中会话提示）  |
| denied desktop permission keeps tab counts working and Disconnect clears attention           | ③   | 桌面通知权限被拒后的降级边界（角标不依赖通知权限） |

### auth-identity.spec.ts（留 3/3）

| 测试                                                                 | 类  | 守的链路                                           |
| -------------------------------------------------------------------- | --- | -------------------------------------------------- |
| rejects invalid auth before the product shell is ever mounted        | ③   | 无效凭据在产物壳挂载前被拒                         |
| accepts a profile-routable web identity but closes a scoped mismatch | ③   | 身份可路由但 scope 不匹配必须断开（身份/目录隔离） |
| binds a cross-profile launch to the resolved profile before open     | ③   | 跨 profile 启动绑定到解析出的 profile 才打开       |

### canonical-recovery.spec.ts（留 1/1）

| 测试                                                        | 类  | 守的链路                                       |
| ----------------------------------------------------------- | --- | ---------------------------------------------- |
| refresh shows the interrupted turn（canonical replay 变体） | ④   | 刷新后中断回合按 canonical replay 呈现，不重演 |

### capacity-and-peers.spec.ts（留 1/1）

| 测试                                                                                   | 类  | 守的链路                                            |
| -------------------------------------------------------------------------------------- | --- | --------------------------------------------------- |
| holds twelve browser turns and three browser-started native peers on one pooled socket | ④   | 单池 socket 上的容量不变量（12 回合 + 3 原生 peer） |

### chat-handover.spec.ts（留 2/3）

| 测试                                                                                   | 类  | 守的链路                                 |
| -------------------------------------------------------------------------------------- | --- | ---------------------------------------- |
| Resume chat and an owned seat release control before sending once                      | ②   | 外部持有座席恢复后一次性归还发送权       |
| a late collision cannot replace newer text or images, then restores the complete draft | ④   | 迟到的交接不能覆盖更新的草稿（竞态恢复） |

### command-surface.spec.ts（留 3/8）

| 测试                                                                                                     | 类  | 守的链路                                                    |
| -------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------- |
| fails closed for an unknown command and sends no model input                                             | ⑤/③ | 未知命令 fail-closed、永不进模型（仓库 AGENTS.md 架构规则） |
| keeps the rewind receipt and restores only the owning prompt draft after canonical refresh               | ④   | 回执经 canonical 刷新保留 + 草稿归属恢复                    |
| queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only | ②   | gather 合成在忙碌会话排队、黑板刷新只读（跨功能）           |

### connection-storage.spec.ts（留 2/6）

| 测试                                                                                            | 类  | 守的链路                                        |
| ----------------------------------------------------------------------------------------------- | --- | ----------------------------------------------- |
| closed-tab drafts restore only for the authenticated principal and Forget clears that principal | ③   | 草稿只归还给认证主体；Forget 清主体（身份隔离） |
| a 51st unsent draft evicts the oldest, stays saved, and never blocks navigation                 | ④   | 草稿容量逐出最旧者且不阻塞导航（数据完整性）    |

### conversation-search.spec.ts（留 1/6）

| 测试                                                                     | 类  | 守的链路                                          |
| ------------------------------------------------------------------------ | --- | ------------------------------------------------- |
| ⌘F opens the search bar over an open session and matches transcript text | ①   | 会话内搜索打开并命中（其余为按键/持久化参数变体） |

### copy-conversation.spec.ts（留 0/3）

整文件不留：复制为 Markdown 是单一功能，无跨系统不变量（手机头部变体一并删）。

### delivered-files.spec.ts（留 1/2）

| 测试                                                                                      | 类  | 守的链路                              |
| ----------------------------------------------------------------------------------------- | --- | ------------------------------------- |
| shows files the agent delivers, previews images, downloads them, and keeps them on reload | ①   | 产物投递 → 预览/下载 → 刷新保留主流程 |

### diff-review.spec.ts（留 2/4）

| 测试                                                                                    | 类  | 守的链路                                     |
| --------------------------------------------------------------------------------------- | --- | -------------------------------------------- |
| diff syntax and word marks preserve inert, selectable text in both themes and on mobile | ③   | diff 渲染保持惰性可选（不安全内容不可执行）  |
| Changes works before a turn and ignores a late workspace reply after changing scope     | ②/④ | diff 在回合前可用 + 改范围后迟到的应答被丢弃 |

### draft-recovery.spec.ts（留 1/2）

| 测试                                                                                   | 类  | 守的链路                                   |
| -------------------------------------------------------------------------------------- | --- | ------------------------------------------ |
| reload restores exact unsent text without dispatching it, and sent drafts stay cleared | ④   | 刷新恢复未发送草稿且不派发（失败写变体删） |

### driver-discovery.spec.ts（留 6/9）

| 测试                                                                                                | 类  | 守的链路                                                          |
| --------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------- |
| renders a healthy EXTERNAL disclosure from the real empty terminal operations page                  | ①   | 外部驱动发现：真实终端操作页 → 健康披露                           |
| holds ONLY the first walk of a workspace: same-workspace sibling completes while A stays held       | ④   | 同工作区只持有首次 walk 的并发语义                                |
| A/B: exact synthetic driver ID per selected Session; releasing held A never leaks into a selected B | ③   | 驱动 ID 归属选中会话，释放不跨会话泄漏                            |
| surfaces a typed refusal and never mounts a disclosure for it                                       | ③   | 类型化拒绝不上披露面（fail-closed）                               |
| rejects a MALFORMED disclosure binding at the strict decode boundary                                | ④   | 严格解码边界拒绝畸形绑定（帧解析）                                |
| transitions healthy -> refused across a transport reconnect on the SAME record                      | ④   | 同一条记录在传输重连上健康→拒绝的转换（healthy→malformed 变体删） |

### final-input.spec.ts（留 2/7）

| 测试                                                                    | 类  | 守的链路                                     |
| ----------------------------------------------------------------------- | --- | -------------------------------------------- |
| approval shortcuts ignore modified keys and IME composition             | ③   | 审批快捷键忽略修饰键与 IME 组合（误触边界）  |
| long approval remains readable and actionable in a short phone viewport | ①   | 手机短视口审批完整可读可操作（手机独有边界） |

### final-reading.spec.ts（留 2/7）

| 测试                                                                                        | 类  | 守的链路                                             |
| ------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| 360-message history stays readable while new output streams and unsafe Markdown stays inert | ③/④ | 长历史流式可读 + 不安全 Markdown 惰性（安全+完整性） |
| code copy reports rejected and missing clipboard APIs without losing the code               | ④   | 剪贴板 API 被拒/缺失时报错且不丢代码（失败恢复）     |

### interaction-ownership.spec.ts（留 2/3）

| 测试                                                                                           | 类  | 守的链路                                             |
| ---------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| restores and resolves a parked question on its owning Session with exact ids                   | ②   | 挂起问题回到归属会话按精确 id 解决（审批参数变体删） |
| keeps three concurrent parked questions bound to their Sessions and resolves them out of order | ④   | 并发挂起问题绑定归属、乱序解决不串会话               |

### keyboard-parity.spec.ts（留 2/7）

| 测试                                                                | 类  | 守的链路                                              |
| ------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| opens, navigates, and executes the command palette by keyboard only | ①   | 纯键盘打开/导航/执行命令面板（其余 Alt+X 为参数变体） |
| Esc closes the palette inertly and interrupts only a live turn      | ②/③ | Esc 惰性关面板、只中断活动回合（Esc×中断危险边界）    |

### loaf.spec.ts（留 1/1）

| 测试                                             | 类  | 守的链路                       |
| ------------------------------------------------ | --- | ------------------------------ |
| streaming turn stays under the long-frame budget | ④   | 流式回合长帧预算（性能完整性） |

### local-preferences.spec.ts（留 2/6）

| 测试                                                                                                                            | 类  | 守的链路                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------- |
| bare Normal Escape interrupts only the selected owner, while Vim changes preserve the other busy Session                        | ②   | Vim Escape 只中断选中属主、不扰另一忙碌会话（跨会话键盘隔离） |
| only explicit save persists display preferences; reload restores preferences and the separate draft without storing credentials | ③   | 显示偏好显式保存、存储不含凭据（浏览器状态边界，AGENTS.md）   |

### modal-a11y.spec.ts（留 1/4）

| 测试                                                | 类  | 守的链路                                 |
| --------------------------------------------------- | --- | ---------------------------------------- |
| Tab and Shift+Tab cycle focus inside the modal only | ⑤   | 模态焦点囚禁（其余为同一守卫的参数变体） |

### modal-stack.spec.ts（留 1/2）

| 测试                                                         | 类  | 守的链路                                                       |
| ------------------------------------------------------------ | --- | -------------------------------------------------------------- |
| review above an approval owns Tab and Escape（任一视口变体） | ②   | 评审叠在审批之上时 Tab/Esc 的模态栈归属（provider 确认变体删） |

### model-management.spec.ts（留 2/2）

| 测试                                                          | 类  | 守的链路                             |
| ------------------------------------------------------------- | --- | ------------------------------------ |
| manages a provider through the DSH-style Models settings flow | ①   | Models 设置主流程                    |
| keeps a rejected provider draft while redacting the failure   | ③/④ | 失败的凭据写入脱敏失败信息且保留草稿 |

### multi-session-fence-soak.spec.ts（留 1/1）

| 测试                                                                                                                                              | 类  | 守的链路                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------- |
| holds 12 Sessions + 3 native peers on one pooled socket, refuses a peer-owned interrupt with the fence notice, and keeps per-Session record order | ④   | 高负载围栏：peer 属主中断被拒 + 每会话记录顺序 |

### multi-session-recovery-soak.spec.ts（留 2/4）

| 测试                                                                                                                                     | 类  | 守的链路                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| parks a background approval on its owning Session across A/B/C switching, drains its queued followup, and survives an observer reconnect | ②/④ | 后台审批挂起归属 + 观察者重连存活                    |
| keeps exactly ONE live transport while an active A and its queued A2 recover across a transport disconnect                               | ④   | 断线恢复中恰一条活动传输的不变量（其余 wave 变体删） |

### native-workflows.spec.ts（留 6/12）

| 测试                                                                                                                    | 类  | 守的链路                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------ |
| native commands fail closed when the original fixture does not advertise them                                           | ③   | 未广告的原生命令 fail-closed                                             |
| Enter steers a compatible running turn by default — no /steer on needed                                                 | ①   | Enter 默认 steering 的输入×回合跨功能链                                  |
| the Queue control defers compatible input that Enter would steer                                                        | ②   | Queue 让行 Enter 会 steering 的输入                                      |
| a dropped native steer returns once to its owning FIFO while a different Session is selected                            | ④   | 掉线 steer 一次性回归属主 FIFO（归属恢复）                               |
| goal pause, resume and stop preserve the current objective and budget, and newer notifications cancel stale transitions | ②   | goal 生命周期×通知：新通知取消过期转换                                   |
| native agent receipts settle terminal status and delayed artifact reads cannot cross Session ownership                  | ③   | 延迟产物读取不可跨会话归属（asides/inspectors/monitors/loop 参数变体删） |

### onboarding.spec.ts（留 3/4）

| 测试                                                                                        | 类  | 守的链路                                         |
| ------------------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| validates the address without opening a socket and leaves focus on the correction           | ①   | 连接门地址校验不开 socket                        |
| explains missing authentication while preserving password privacy and IME entry             | ③   | 认证缺失提示不泄漏已输入密码（凭据边界）         |
| starts a first workspace with the keyboard and focuses the useful field when adding another | ①   | 键盘完成首个工作区创建（Escape/backdrop 变体删） |

### pairing-link.spec.ts（留 2/7）

| 测试                                                           | 类  | 守的链路                                      |
| -------------------------------------------------------------- | --- | --------------------------------------------- |
| an octos origin off this computer is refused without a request | ③   | 非本机来源拒绝且不发起请求（来源校验）        |
| the paired token survives only this tab until Forget           | ③   | 配对令牌只存活本标签页直至 Forget（凭据范围） |

### peer-activity-and-restore.spec.ts（留 2/5）

| 测试                                                                        | 类  | 守的链路                                                |
| --------------------------------------------------------------------------- | --- | ------------------------------------------------------- |
| a peer turn terminal lands the row as done while its sibling stays unlanded | ①   | 真实 peer 事件 → 行落地归属（idle/approval 参数变体删） |
| a draft is restored only in the session that owned the interrupted turn     | ④   | 中断提示草稿只回归属会话（身份恢复）                    |

### peer-control.spec.ts（留 4/8）

| 测试                                                                | 类  | 守的链路                                               |
| ------------------------------------------------------------------- | --- | ------------------------------------------------------ |
| no seat panel when external_driver_v1 is unadvertised (no-feature)  | ⑤   | P2d 严格 opt-in：无 feature 无座席（no-method 变体删） |
| each of the four commands emits exactly ONE peer/control frame      | ①   | 座席四命令各发恰好一帧的线协议                         |
| a refused RECEIPT renders the typed peer_control_refused refusal    | ④   | 类型化拒绝渲染（accepted/replay 参数变体删）           |
| a driver_fence_stale typed error drops the seat, keeps the §6 label | ④   | 围栏过期丢座席留有限文案（keyboard-reachable 变体删）  |

### peer-controller.spec.ts（留 4/11）

| 测试                                                                       | 类  | 守的链路                                                        |
| -------------------------------------------------------------------------- | --- | --------------------------------------------------------------- |
| Start acquires then emits exactly ONE peer/dispatch and adopts a Fleet row | ①   | Fleet 派发主流程：获取→一帧→入列                                |
| a second Start mints a DISTINCT operation id (no accidental replay)        | ④   | 二次 Start 新操作 id（幂等/重放）                               |
| a stale lease refuses peer/dispatch with the bounded §6 label              | ④   | 过期租约拒派发（steer/approve/stop 一帧为 peer-control 变体删） |
| a refused peer/dispatch renders the bounded label, never server copy       | ③   | 拒绝渲染有限文案不搬服务器原文                                  |

### peer-dock.spec.ts（留 1/1）

| 测试                                                                     | 类  | 守的链路                        |
| ------------------------------------------------------------------------ | --- | ------------------------------- |
| peer dock shows the staged roster and keeps approval actions fail-closed | ②   | 座席坞花名册 + 审批 fail-closed |

### peer-readonly-composer.spec.ts（留 1/1）

| 测试                                                          | 类  | 守的链路                 |
| ------------------------------------------------------------- | --- | ------------------------ |
| focused peer shows the read-only composer and Esc never leaks | ③   | 聚焦 peer 的只读输入边界 |

### plan-card.spec.ts（留 1/3）

| 测试                                                                    | 类  | 守的链路                                            |
| ----------------------------------------------------------------------- | --- | --------------------------------------------------- |
| shows the plan, replaces it wholesale, and clears it when the turn ends | ①   | 计划卡呈现/整体替换/回合结束清除（键盘/门控变体删） |

### product.spec.ts（留 21/37）

| 测试                                                                                       | 类  | 守的链路                                                                 |
| ------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------ |
| authenticates before any session and owns workspace selection in the hero                  | ①   | 认证先行 + 工作区选择在 hero                                             |
| keeps authentication when a remembered Session can no longer open                          | ④   | 记忆会话打不开时认证不回退                                               |
| keeps a server-accepted turn and sibling records on the same pooled socket                 | ④   | 已接受回合与兄弟记录共用单池 socket                                      |
| keeps B selected when A's unacknowledged start is rejected                                 | ④   | A 未确认启动被拒时 B 保持选中（held-start 竞态族代表）                   |
| recovers A's held start after B is already selected without reopening B                    | ④   | A 持有启动在 B 选中后恢复且不重开 B（同族其余 6 条参数变体删）           |
| reports a start acknowledgement timeout as unknown, then settles on release                | ④   | 启动确认超时先 unknown 后落定                                            |
| parks a recovery-admitted approval as Waiting, not Working                                 | ②   | 恢复准入的审批挂 Waiting 不冒进 Working                                  |
| does not project ambiguous legacy Session rows into a Workspace                            | ④   | 歧义旧行不投影进工作区（数据完整性）                                     |
| lists a workspace's server-attested history in a fresh tab and opens a row it never opened | ①   | 新标签页列出服务器背书历史并打开未开过行                                 |
| moves drafts only after a profile-choice Session transition commits                        | ④   | profile 选择过渡提交后才移动草稿                                         |
| restores the origin, tab credential, session, and workspace after refresh                  | ④   | 刷新恢复 origin/凭据/会话/工作区四元组                                   |
| offers whole permission presets and confirms full access                                   | ③   | 权限整档预设 + 完全访问确认                                              |
| separates the Session runtime from the Profile default model                               | ②   | 会话运行时与 profile 默认模型分离（跨功能）                              |
| owns plan and background work under the active session Trajectory                          | ②   | 计划与后台工作归属活动会话 Trajectory                                    |
| does not expose implementation and diagnostic concepts as product IA                       | ⑤   | 实现/诊断概念不进产物 IA 的设计边界                                      |
| sends prompts without presenting billed input usage as context occupancy                   | ⑤   | 计费输入不冒充上下文占用的诚实性设计                                     |
| recovers the durable session after disconnect and lossy replay                             | ④   | 断线 + 有损重放后的持久会话恢复                                          |
| resolves approval and structured-question takeovers                                        | ②   | 审批与结构化问题接管                                                     |
| keeps the DSH-aligned dark product shell WCAG A/AA clean                                   | ⑤   | axe 门禁：暗色产物壳 WCAG A/AA（keyboard/semantics 与 skip-link 变体删） |
| preserves workspace launch decisions without exposing profile ids in connect               | ③   | 连接不暴露 profile id（身份/隐私）                                       |
| onboards an empty solo server from workspace creation                                      | ①   | 空 solo 服务器从建工作区起步（自动激活变体删）                           |
| preserves Octoscode keyless-provider onboarding semantics                                  | ⑤   | 无 key provider 入门语义的设计例外                                       |

### profile-mutation.spec.ts（留 2/2）

| 测试                                                                                          | 类  | 守的链路                                         |
| --------------------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| skill writes hold the profile lock through deferred replies and deduplicate confirmation      | ④   | profile 锁贯穿延迟应答 + 确认去重（并发/完整性） |
| a failed credential write clears its input, consumes confirmation and requires a fresh review | ③   | 凭据写失败清输入、需重新评审（安全）             |

### release-readiness.spec.ts（留 0/2）

整文件不留：skip-link/多行 a11y 由 product.spec 的 axe 批次代表；空搜索返回路径是单一功能。

### resume-and-reasoning.spec.ts（留 4/4）

| 测试                                                                                                   | 类  | 守的链路                                         |
| ------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------ |
| resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history | ③   | 恢复未验证候选需确认 + canonical 历史（安全）    |
| canceling a held historical open cannot install a late transcript or steal a new selection             | ④   | 取消后迟到的历史 transcript 不能偷新选中（竞态） |
| resuming an already retained busy historical Session never reopens or resets its turn                  | ②   | 恢复已保留的忙碌历史会话不重开不复位             |
| reasoning visibility is retained per Session and does not change captured model effort                 | ②   | reasoning 可见性按会话保留、不改模型 effort 记录 |

### runtime-recovery.spec.ts（留 1/1）

| 测试                                                                                  | 类  | 守的链路                         |
| ------------------------------------------------------------------------------------- | --- | -------------------------------- |
| continues past an unknown turn without replaying it or losing the queue and new draft | ④   | 未知回合不重演、队列与新草稿不丢 |

### server-shutdown.spec.ts（留 1/1）

| 测试                                                                                 | 类  | 守的链路                          |
| ------------------------------------------------------------------------------------ | --- | --------------------------------- |
| server shutdown is capability gated, explicit, and truthful on an unconfirmed result | ⑤   | 关机能力门控 + 未确认结果如实陈述 |

### session-links.spec.ts（留 2/8）

| 测试                                                                                | 类  | 守的链路                                           |
| ----------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| opens a bookmarked conversation in a fresh browser only after an explicit choice    | ③   | 书签会话须显式选择才打开（安全）                   |
| refuses a saved-link candidate with a different workspace before requesting history | ③   | 工作区不匹配的保存链接在请求历史前拒绝（目录隔离） |

### settings-mobile.spec.ts（留 1）

| 测试                                     | 类  | 守的链路                                 |
| ---------------------------------------- | --- | ---------------------------------------- |
| Settings remain operable（任一视口变体） | ①   | 手机视口 Settings 可操作（手机独有边界） |

### simultaneous-sessions.spec.ts（留 3/5）

| 测试                                                                                             | 类  | 守的链路                                               |
| ------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------ |
| isolates independent turns across rapid Session switches                                         | ④   | 快速切换下独立回合隔离                                 |
| recovers an unacknowledged A1 behind B and drains A2 then A3 without replaying A1                | ④   | 未确认 A1 恢复 + FIFO 顺序排空不重演（drain 变体删）   |
| preserves native persisted segment finality across late deltas and the next background FIFO turn | ④   | 迟到 delta 与后台 FIFO 下原生段 finality（数据完整性） |

### surface-recovery.spec.ts（留 2/5）

| 测试                                                                       | 类  | 守的链路                                                               |
| -------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------- |
| a failed model-management chunk preserves the owner, queue, draft and Stop | ④   | 失败 chunk 不丢属主/队列/草稿/停止（import 取消/Escape/review 变体删） |
| a late clipboard command result does not enter a different conversation    | ④   | 迟到剪贴板命令结果不进另一会话（竞态）                                 |

### tab-lock.spec.ts（留 1/1）

| 测试                                                                    | 类  | 守的链路                                       |
| ----------------------------------------------------------------------- | --- | ---------------------------------------------- |
| a second tab sees the lock, takes over, and the first tab sees the loss | ④   | 多标签锁：第二标签可见可接管、第一标签感知丢失 |

### takeover-layout.spec.ts（留 1）

| 测试                                                                     | 类  | 守的链路                                   |
| ------------------------------------------------------------------------ | --- | ------------------------------------------ |
| approval keeps the document and header stable（任一 kind×viewport 变体） | ①   | 窄视口接管时文档与头部稳定（手机独有边界） |

### task-templates.spec.ts（留 0/3）

整文件不留：模板填充消息框是单一功能，手机堆叠变体一并删。

### theme.spec.ts（留 1/2）

| 测试                                                             | 类  | 守的链路                                                  |
| ---------------------------------------------------------------- | --- | --------------------------------------------------------- |
| theme cycle preserves one palette across manual and system modes | ⑤   | 手动/系统模式下单一调色板的设计例外（暗 OS 可读性变体删） |

### timeline-interactions.spec.ts（留 1/1）

| 测试                                                                               | 类  | 守的链路                                               |
| ---------------------------------------------------------------------------------- | --- | ------------------------------------------------------ |
| keeps activity and reader-controlled disclosures correct across ten streamed turns | ④   | 十个流式回合上活动披露与读者控制披露正确（长流完整性） |

### visual.spec.ts（留 2/5）

| 测试                               | 类  | 守的链路                                                          |
| ---------------------------------- | --- | ----------------------------------------------------------------- |
| connect gate matches baseline      | ⑤   | 连接门视觉基线（关键 surface）                                    |
| approval takeover matches baseline | ⑤   | 审批接管视觉基线（关键 surface；其余三个为非关键 surface 变体删） |

注：视觉基线属静态外观绑定，按 TEST-DIET 原则上可全删；留两条关键 surface 供 lead 定夺，T-0501 时可再砍。

### workspace-browse.spec.ts（留 2/5）

| 测试                                                                             | 类  | 守的链路                                 |
| -------------------------------------------------------------------------------- | --- | ---------------------------------------- |
| browses the server's folders, drills in and out, and reports what the server hid | ①   | 服务器目录浏览进出 + 隐藏项如实报告      |
| shows no Browse affordance at all when the server does not advertise the feature | ⑤   | 未广告能力不出现 Browse 入口（门控设计） |

### workspace-ux.spec.ts（留 4/10）

| 测试                                                                               | 类  | 守的链路                                             |
| ---------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| IME confirmation and multiline editing never send; queued messages can be removed  | ③/① | IME 确认/多行编辑不误发 + 排队消息可撤               |
| protects a running turn from closing the tab and removes the warning on completion | ④   | 活动回合防误关标签页、完成后解除警告（数据丢失防护） |
| keeps the mobile composer on screen and makes navigation an accessible drawer      | ①   | 手机输入框常驻 + 导航为可达抽屉（手机独有边界）      |
| follows arriving content but leaves a reader in history until they jump to latest  | ②   | 跟随新内容但不拽回正在读历史的用户（跨功能）         |

## 整文件删除（7 个）

copy-conversation、release-readiness、task-templates 三个文件清空后删除；`e2e/workspace.smoke.ts`
与 `session-settings.ts`
为辅助件，随 T-0501 按需保留/迁移，不在本清单统计。视觉基线（visual.spec）与模态 a11y 的具体去留以 lead 验收意见为准。

## 执行备注（T-0501）

- 删除时连同对应 fixture/辅助引用一起清；soak 大文件（product/multi-session-*/driver-discovery/native-workflows）删除参数变体后若文件仍大，按本清单逐条核对再删。
- 删后跑 `python3 wake/test-lines.py` 回填本文件「基线与预计」一节实测数字。
- CI 检查名与分片配置不变；删空的 spec 文件直接从工作流矩阵移除由 T-0501 单独评估。
