# e2e 保留清单（T-0500，shu 11-07 新法）

本清单是 e2e 目录的**唯一保留清单**，为 T-0501 整批删除定边界。**不在清单内的测试默认后续全删**，不逐条写删除理由。

判定依据 `wake/lanes/TEST-DIET.md` 第 1–5 类：

- **① 跨系统链路**：真实 Chromium + mock 服务器 + WS 的用户可感知主流程。
- **② 跨功能**：两个功能互相影响（如撤销×产物、中断×工具、队列×会话切换）。
- **③ 安全边界**：每类只留一两个（来源校验、凭据范围/脱敏、权限、fail-closed）。
- **④ 并发 / 数据完整性 / 恢复**：帧级正确性、断线/刷新恢复、出错不丢数据，每类留最关键的。
- **⑤ 有意设计例外**：改之前要二次思考的设计决定，能链接处已链接。

规则补充：同一守卫的参数变体（换会话、换视口、换命令）只留最有代表性的一个；桌面/手机、故障恢复、身份/目录隔离等**独有边界**不得漏；不以 mock 结构代替真实状态。静态截图基线属外观绑定，不保留（AGENTS.md 不测 cosmetic
styling）。

## 基线与预计

- **基线**（origin/main
  `9485201`，`python3 wake/test-lines.py`）：全仓 51,282 行测试 / 1,040 个；e2e
  **32,585 行 / 488 个**（全仓最大目录）。
- **盘点**：`pnpm exec playwright test --list`
  列出 94 个 spec、485 个测试调用（参数变体展开后 515 个）。下表每一行都按文件和完整标题对过这份列表，各命中一个测试；参数化测试写明保留的那一个变体，其余变体随 T-0501 删。
- **保留**：**166 个测试**，分布在 71 个文件（① 35、② 27、③ 37、④ 56、⑤
  11，按首类计）。T-0530 补回 2 条后为 **168 个**（② 28、③
  38），另有 2 条并入已有链路，不增测试数。
- **预计删后**：保留测试本身约 10,800 行；连同这些文件现有的全部 import 和 harness，上限约 18,400 行。e2e 约 1.1–1.8 万行，全仓约 2.9–3.7 万行。

## T-0530 补回（11-08）

2026-11-08 审计（`wake/audit/review-2026-11-08.md`）指出 #412 清单漏了跨功能和失败路径。T-0530 按当前 main 和 T-0528 的安全语义补回，不整文件恢复：

- 新增 2 条：`template-interactions` 的只读模板等回执、`approval-clarity` 的
  `applied` 回执。
- 并入 2 条已有链路：`turn-undo`
  主链加入 Core 拒绝的重做不重试、后续回合后不再重做；`delivered-files`
  主链加入交付时快照。
- 旧 localStorage 令牌清理留在 apps/web 单测一侧（T-0529），e2e 不重复。
- 「回执」mock 提为 `e2e/permission-receipt.ts`，`approval-clarity`
  3 条和模板 1 条共用；另有 5 个 spec 改用 `fixture-session.ts` 已导出的
  `connectAndStartWorkspace`。测试行数净增 ≤ 0。

## 保留清单

### approval-clarity.spec.ts（留 4/11）

| 测试                                                                              | 类  | 守的链路                                                                                    |
| --------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------- |
| switching stops the running workaround, then redoes the request with write access | ②   | 拒写后切到可写：先停掉正在跑的变通回合，再按原请求重做（权限×运行中回合）                   |
| a late permission retry never starts in or clears another Session                 | ④   | 迟到的权限重试不在别的会话启动、也不清别的会话                                              |
| permission retry refuses a response that broadens network access                  | ③   | 权限重试拒绝扩大网络访问的应答（不越权）                                                    |
| permission retry requires an applied workspace-write response                     | ③   | 权限重试只认 `applied` 回执：`applied:false` 时报错、不重做回合（fail-closed；T-0530 补回） |

### artifact-preview.spec.ts（留 2/12）

| 测试                                                           | 类  | 守的链路                                 |
| -------------------------------------------------------------- | --- | ---------------------------------------- |
| keeps a structured write artifact and its preview after reload | ①   | 写入产物与预览在刷新后仍在               |
| keeps HTML and SVG scripts and network access inert            | ③   | 预览中的 HTML/SVG 脚本和网络访问保持惰性 |

### attention.spec.ts（留 2/4）

| 测试                                                                                         | 类  | 守的链路                                           |
| -------------------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| denied desktop permission keeps tab counts working and Disconnect clears attention           | ③   | 桌面通知权限被拒后的降级边界（角标不依赖通知权限） |
| a background Session completing while another is selected signals and acknowledges on return | ②   | 跨会话注意力信号与确认（后台完成 → 选中会话提示）  |

### auth-identity.spec.ts（留 3/3）

| 测试                                                                 | 类  | 守的链路                                           |
| -------------------------------------------------------------------- | --- | -------------------------------------------------- |
| rejects invalid auth before the product shell is ever mounted        | ③   | 无效凭据在产物壳挂载前被拒                         |
| accepts a profile-routable web identity but closes a scoped mismatch | ③   | 身份可路由但 scope 不匹配必须断开（身份/目录隔离） |
| binds a cross-profile launch to the resolved profile before open     | ③   | 跨 profile 启动绑定到解析出的 profile 才打开       |

### canonical-recovery.spec.ts（留 1/1）

| 测试                                                              | 类  | 守的链路                                                                 |
| ----------------------------------------------------------------- | --- | ------------------------------------------------------------------------ |
| refresh shows the interrupted turn with complete canonical replay | ④   | 刷新后中断回合按 canonical replay 呈现，不重演（legacy terminal 变体删） |

### capacity-and-peers.spec.ts（留 1/1）

| 测试                                                                                   | 类  | 守的链路                                            |
| -------------------------------------------------------------------------------------- | --- | --------------------------------------------------- |
| holds twelve browser turns and three browser-started native peers on one pooled socket | ④   | 单池 socket 上的容量不变量（12 回合 + 3 原生 peer） |

### chat-handover.spec.ts（留 2/3）

| 测试                                                                                                        | 类  | 守的链路                                                        |
| ----------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------- |
| a refused Resume chat can be retried, and Resume chat and an owned seat release control before sending once | ②   | 被拒的 Resume chat 可重试，恢复后与自有座席一起一次性归还发送权 |
| a late collision cannot replace newer text or images, then restores the complete draft                      | ④   | 迟到的交接不能覆盖更新的草稿（竞态恢复）                        |

### command-surface.spec.ts（留 3/8）

| 测试                                                                                                     | 类  | 守的链路                                                    |
| -------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------- |
| fails closed for an unknown command and sends no model input                                             | ⑤/③ | 未知命令 fail-closed、永不进模型（仓库 AGENTS.md 架构规则） |
| keeps the rewind receipt and restores only the owning prompt draft after canonical refresh               | ④   | 回执经 canonical 刷新保留 + 草稿归属恢复                    |
| queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only | ②   | gather 合成在忙碌会话排队、黑板刷新只读（跨功能）           |

### composer-bar.spec.ts（留 2/8）

| 测试                                                                            | 类  | 守的链路                                        |
| ------------------------------------------------------------------------------- | --- | ----------------------------------------------- |
| another folder starts a new session that keeps the unsent text                  | ②   | 换文件夹开新会话时保留未发送文字（工作区×草稿） |
| sending waits for uploads, then carries the files and shows them on the message | ①   | 发送等上传完成，文件随消息送出并显示在消息上    |

### composer-skill-actions.spec.ts（留 1/4）

| 测试                                                                                                             | 类  | 守的链路                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------- |
| runs a skill action from the composer, retries a failed job into a new job, and tracks the jobs across a refresh | ①   | 从输入区运行技能动作，失败重试成新 job，刷新后 job 仍可追踪（手机变体删） |

### connection-storage.spec.ts（留 2/6）

| 测试                                                                                            | 类  | 守的链路                                        |
| ----------------------------------------------------------------------------------------------- | --- | ----------------------------------------------- |
| closed-tab drafts restore only for the authenticated principal and Forget clears that principal | ③   | 草稿只归还给认证主体；Forget 清主体（身份隔离） |
| a 51st unsent draft evicts the oldest, stays saved, and never blocks navigation                 | ④   | 草稿容量逐出最旧者且不阻塞导航（数据完整性）    |

### connector-management.spec.ts（留 3/14）

| 测试                                                                | 类  | 守的链路                                     |
| ------------------------------------------------------------------- | --- | -------------------------------------------- |
| manages HTTP connectors and keeps existing stdio controls           | ①   | 连接器管理主流程                             |
| adds a stdio connector from the server's allowlist, never a command | ③   | stdio 连接器只能从服务器白名单选，不能填命令 |
| a delayed refresh blocks mutations and always releases busy state   | ④   | 刷新未返回时挡住修改，且总会解除忙碌状态     |

### connector-oauth.spec.ts（留 3/9）

| 测试                                                                             | 类  | 守的链路                                         |
| -------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| signs a connector in through the provider and back                               | ①   | 连接器 OAuth 登录往返主流程                      |
| a sign-in returning after the page was refreshed is turned away                  | ③   | 页面刷新后回来的登录回跳被拒（state 不跨刷新）   |
| a restart-pending sign-in survives refreshes until the server confirms connected | ④   | 等服务器重启的登录熬过刷新，直到服务器确认已连接 |

### conversation-search.spec.ts（留 1/6）

| 测试                                                                     | 类  | 守的链路                                          |
| ------------------------------------------------------------------------ | --- | ------------------------------------------------- |
| ⌘F opens the search bar over an open session and matches transcript text | ①   | 会话内搜索打开并命中（其余为按键/持久化参数变体） |

### cron-create-delete.spec.ts（留 4/11）

| 测试                                                                 | 类  | 守的链路                                                    |
| -------------------------------------------------------------------- | --- | ----------------------------------------------------------- |
| creates At, Every and Cron jobs, then deletes one after confirmation | ①   | 定时任务三种类型创建 + 确认后删除                           |
| uses the current session scope for list, toggle, create and delete   | ③   | 定时任务的列、开关、建、删都限定在当前会话范围              |
| ignores a late create response after the session view changes        | ④   | 切换会话后迟到的创建应答被忽略                              |
| shows how each run really went and opens the run it points at        | ②   | 定时运行结果如实显示，并能打开它指向的会话回合（定时×会话） |

### delivered-files.spec.ts（留 1/2）

| 测试                                                                                      | 类  | 守的链路                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shows files the agent delivers, previews images, downloads them, and keeps them on reload | ①/④ | 产物投递 → 预览/下载 → 刷新保留主流程；原文件读不到且无交付时大小时，预览从 `.artifacts/delivered/` 交付时快照取大小（T-0530 并入，原 artifact-preview 一条） |

### diff-review.spec.ts（留 3/7）

| 测试                                                                                    | 类  | 守的链路                                     |
| --------------------------------------------------------------------------------------- | --- | -------------------------------------------- |
| diff syntax and word marks preserve inert, selectable text in both themes and on mobile | ③   | diff 渲染保持惰性可选（不安全内容不可执行）  |
| Changes works before a turn and ignores a late workspace reply after changing scope     | ②/④ | diff 在回合前可用 + 改范围后迟到的应答被丢弃 |
| reconnects preserve the selected preview and Git scope without new diff reads           | ④   | 重连保留选中的预览和 Git 范围，不重复读 diff |

### draft-recovery.spec.ts（留 1/2）

| 测试                                                                                   | 类  | 守的链路                                   |
| -------------------------------------------------------------------------------------- | --- | ------------------------------------------ |
| reload restores exact unsent text without dispatching it, and sent drafts stay cleared | ④   | 刷新恢复未发送草稿且不派发（失败写变体删） |

### driver-discovery.spec.ts（留 6/10）

| 测试                                                                                                | 类  | 守的链路                                                          |
| --------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------- |
| renders a healthy EXTERNAL disclosure from the real empty terminal operations page                  | ①   | 外部驱动发现：真实终端操作页 → 健康披露                           |
| holds ONLY the first walk of a workspace: same-workspace sibling completes while A stays held       | ④   | 同工作区只持有首次 walk 的并发语义                                |
| A/B: exact synthetic driver ID per selected Session; releasing held A never leaks into a selected B | ③   | 驱动 ID 归属选中会话，释放不跨会话泄漏                            |
| surfaces a typed refusal and never mounts a disclosure for it                                       | ③   | 类型化拒绝不上披露面（fail-closed）                               |
| rejects a MALFORMED disclosure binding at the strict decode boundary                                | ④   | 严格解码边界拒绝畸形绑定（帧解析）                                |
| transitions healthy -> refused across a transport reconnect on the SAME record                      | ④   | 同一条记录在传输重连上健康→拒绝的转换（healthy→malformed 变体删） |

### expert-teams.spec.ts（留 3/12）

| 测试                                                                                                             | 类  | 守的链路                                         |
| ---------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| starts a team, shows each member's progress and result, and merges them here                                     | ①   | 专家团主流程：启动、成员进度与结果、合并回本会话 |
| a failed member is named, a working member survives a refresh and is stopped once, and the merge leaves both out | ④   | 失败成员被点名，进行中的成员熬过刷新且只被停一次 |
| a reconnect keeps a working member working, and sends no stop by itself                                          | ④   | 断线重连不打断进行中的成员，也不自行发 stop      |

### final-input.spec.ts（留 2/7）

| 测试                                                                    | 类  | 守的链路                                     |
| ----------------------------------------------------------------------- | --- | -------------------------------------------- |
| approval shortcuts ignore modified keys and IME composition             | ③   | 审批快捷键忽略修饰键与 IME 组合（误触边界）  |
| long approval remains readable and actionable in a short phone viewport | ①   | 手机短视口审批完整可读可操作（手机独有边界） |

### final-reading.spec.ts（留 2/7）

| 测试                                                                                        | 类  | 守的链路                                             |
| ------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| code copy reports rejected and missing clipboard APIs without losing the code               | ④   | 剪贴板 API 被拒/缺失时报错且不丢代码（失败恢复）     |
| 360-message history stays readable while new output streams and unsafe Markdown stays inert | ③/④ | 长历史流式可读 + 不安全 Markdown 惰性（安全+完整性） |

### handoff-origin.spec.ts（留 1/3）

| 测试                                                                     | 类  | 守的链路                                 |
| ------------------------------------------------------------------------ | --- | ---------------------------------------- |
| a forged cross-origin handoff cannot select where a pasted token is sent | ③   | 伪造的跨源接力不能决定粘贴的令牌发往哪里 |

### hydrate-failure.spec.ts（留 2/3）

| 测试                                                                           | 类  | 守的链路                                          |
| ------------------------------------------------------------------------------ | --- | ------------------------------------------------- |
| a failed reconnect hydrate retains the current Session, Changes and draft      | ④   | 重连后 hydrate 失败仍保留当前会话、Changes 和草稿 |
| a cold hydrate failure stays honest and Start retries without a phantom record | ④   | 冷启动 hydrate 失败如实显示，重试不留幽灵记录     |

### interaction-ownership.spec.ts（留 3/4）

| 测试                                                                                                           | 类  | 守的链路                                                          |
| -------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------- |
| rejects same-base foreign-topic approval and terminal traffic without settling or poisoning the ordinary owner | ③   | 同一基础会话下别的 topic 的审批和结束帧被拒，不结算也不污染本会话 |
| restores and resolves a parked question on its owning Session with exact ids                                   | ②   | 挂起问题回到归属会话按精确 id 解决（审批参数变体删）              |
| keeps three concurrent parked questions bound to their Sessions and resolves them out of order                 | ④   | 并发挂起问题绑定归属、乱序解决不串会话                            |

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

### memory-import.spec.ts（留 2/9）

| 测试                                                                                                    | 类  | 守的链路                                                   |
| ------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------- |
| previews a file in full, writes nothing until confirmed, then reports the server's counts               | ①   | 记忆导入主流程：完整预览、确认前不写、报告服务器计数       |
| a reply lost after the server wrote the batch is not sure, is read back, and is never resent on its own | ④   | 服务器已写入但应答丢失时标为不确定、回读核对、绝不自动重发 |

### mobile-handoff.spec.ts（留 2/4）

| 测试                                                                     | 类  | 守的链路                                   |
| ------------------------------------------------------------------------ | --- | ------------------------------------------ |
| desktop handoff lets a fresh phone approve work without entering folders | ①   | 桌面接力到新手机后直接审批（跨设备主流程） |
| a handoff never auto-connects with this tab's saved credential           | ③   | 接力链接绝不用本标签页保存的凭据自动连接   |

### mobile-remote.spec.ts（留 7/22）

| 测试                                                                                                              | 类  | 守的链路                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------- |
| the overview shows waiting work and allows it once                                                                | ①   | 手机总览显示待处理工作，批准只发一次                           |
| a phone can deny, and never widens permissions                                                                    | ③   | 手机端能拒绝，且绝不扩大权限                                   |
| a phone follow-up completes on the same session and survives a reload                                             | ④   | 手机追问在同一会话完成并熬过刷新                               |
| a phone starts a new session in a watched folder, keeps a refused first task as a draft, and every screen sees it | ②   | 手机在关注文件夹开新会话，被拒的首个任务留作草稿，各屏都看得到 |
| an unreachable server reads as offline, and the overview recovers                                                 | ④   | 服务器不可达显示离线，恢复后总览自动恢复                       |
| a sandbox escalation can only be denied from the phone                                                            | ⑤   | 沙箱提权在手机上只能拒绝（有意设计）                           |
| a peer's question is answered from the phone's dock with the option picked                                        | ②   | 手机坞回答协作者的问题，发送所选项（手机×协作者）              |

### modal-a11y.spec.ts（留 1/4）

| 测试                                                | 类  | 守的链路                                 |
| --------------------------------------------------- | --- | ---------------------------------------- |
| Tab and Shift+Tab cycle focus inside the modal only | ⑤   | 模态焦点囚禁（其余为同一守卫的参数变体） |

### modal-stack.spec.ts（留 1/2）

| 测试                                                  | 类  | 守的链路                                                       |
| ----------------------------------------------------- | --- | -------------------------------------------------------------- |
| review above an approval owns Tab and Escape at 320px | ②   | 评审叠在审批之上时 Tab/Esc 的模态栈归属（provider 确认变体删） |

### model-management.spec.ts（留 3/3）

| 测试                                                                  | 类  | 守的链路                                                        |
| --------------------------------------------------------------------- | --- | --------------------------------------------------------------- |
| manages a provider through the DSH-style Models settings flow         | ①   | Models 设置主流程                                               |
| keeps a rejected provider draft while redacting the failure           | ③/④ | 失败的凭据写入脱敏失败信息且保留草稿                            |
| opening a session with no usable chat model goes to Settings › Models | ②   | 打开没有可用模型的会话时进入 Settings › Models（会话×设置路由） |

### multi-session-fence-soak.spec.ts（留 1/1）

| 测试                                                                                                                                              | 类  | 守的链路                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------- |
| holds 12 Sessions + 3 native peers on one pooled socket, refuses a peer-owned interrupt with the fence notice, and keeps per-Session record order | ④   | 高负载围栏：peer 属主中断被拒 + 每会话记录顺序 |

### multi-session-recovery-soak.spec.ts（留 2/4）

| 测试                                                                                                                                     | 类  | 守的链路                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| parks a background approval on its owning Session across A/B/C switching, drains its queued followup, and survives an observer reconnect | ②/④ | 后台审批挂起归属 + 观察者重连存活                    |
| keeps exactly ONE live transport while an active A and its queued A2 recover across a transport disconnect                               | ④   | 断线恢复中恰一条活动传输的不变量（其余 wave 变体删） |

### native-fleet.spec.ts（留 1/1）

| 测试                                                              | 类  | 守的链路                                                      |
| ----------------------------------------------------------------- | --- | ------------------------------------------------------------- |
| native Fleet uses prepare/open/start, gather, steer and interrupt | ①   | 原生 Fleet 主链：prepare/open/start、gather、steer、interrupt |

### native-workflows.spec.ts（留 5/10）

| 测试                                                                                                                    | 类  | 守的链路                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------- |
| native commands fail closed when the original fixture does not advertise them                                           | ③   | 未广告的原生命令 fail-closed                                                |
| Enter steers a compatible running turn by default, while the Queue control defers it                                    | ①/② | Enter 默认 steering 的输入×回合跨功能链，Queue 控件让行（原两条已合为一条） |
| a dropped native steer returns once to its owning FIFO while a different Session is selected                            | ④   | 掉线 steer 一次性回归属主 FIFO（归属恢复）                                  |
| goal pause, resume and stop preserve the current objective and budget, and newer notifications cancel stale transitions | ②   | goal 生命周期×通知：新通知取消过期转换                                      |
| native agent receipts settle terminal status and delayed artifact reads cannot cross Session ownership                  | ③   | 延迟产物读取不可跨会话归属（asides/inspectors/monitors/loop 参数变体删）    |

### onboarding.spec.ts（留 3/4）

| 测试                                                                                                                                  | 类  | 守的链路                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------- |
| validates the address without opening a socket and leaves focus on the correction                                                     | ①   | 连接门地址校验不开 socket                                                     |
| explains missing authentication while preserving password privacy and IME entry                                                       | ③   | 认证缺失提示不泄漏已输入密码（凭据边界）                                      |
| authenticates without opening a Session, starts a first workspace with the keyboard, and focuses the useful field when adding another | ①   | 认证先行不开会话 + 键盘完成首个工作区创建（product 的 hero 用例已并入，#395） |

### pairing-link.spec.ts（留 2/7）

| 测试                                                           | 类  | 守的链路                                      |
| -------------------------------------------------------------- | --- | --------------------------------------------- |
| an octos origin off this computer is refused without a request | ③   | 非本机来源拒绝且不发起请求（来源校验）        |
| the paired token survives only this tab until Forget           | ③   | 配对令牌只存活本标签页直至 Forget（凭据范围） |

### peer-activity-and-restore.spec.ts（留 2/2）

| 测试                                                                                                         | 类  | 守的链路                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------- |
| rows go idle -> live -> blocked -> live -> done, approvals stay fail-closed, /peer clear prunes the done row | ①/② | 真实 peer 事件驱动行从空闲到完成、审批 fail-closed、/peer clear 清理（peer-dock 已并入，#374） |
| a draft is restored only in the session that owned the interrupted turn                                      | ④   | 中断提示草稿只回归属会话（身份恢复）                                                           |

### peer-control.spec.ts（留 4/5）

| 测试                                                                                        | 类  | 守的链路                                                 |
| ------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------- |
| no seat panel when external_driver_v1 is unadvertised (no-feature)                          | ⑤   | P2d 严格 opt-in：无 feature 无座席（no-method 变体删）   |
| each command, from the keyboard or a click, emits exactly ONE frame and an accepted receipt | ①   | 座席各命令（键盘或点击）各发恰好一帧并收到 accepted 回执 |
| a refused RECEIPT renders the typed peer_control_refused refusal                            | ④   | 类型化拒绝渲染（accepted/replay 参数变体删）             |
| a driver_fence_stale typed error drops the seat, keeps the §6 label                         | ④   | 围栏过期丢座席留有限文案（keyboard-reachable 变体删）    |

### peer-controller.spec.ts（留 2/5）

| 测试                                                                                                                          | 类  | 守的链路                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------- |
| Start opens only with model and brief, dispatches once per Start, and the row's Steer, Approve and Stop each send one frame   | ①/④ | Fleet 派发主流程：每次 Start 恰好一帧，行上 Steer/Approve/Stop 各一帧（#376 合并） |
| a refused dispatch shows its bounded label, never server copy, and Start tries again with a NEW request until one is accepted | ③/④ | 拒绝只显示有限文案、不搬服务器原文，重试用新请求（过期租约用例已并入，#376）       |

### peer-readonly-composer.spec.ts（留 1/1）

| 测试                                                          | 类  | 守的链路                 |
| ------------------------------------------------------------- | --- | ------------------------ |
| focused peer shows the read-only composer and Esc never leaks | ③   | 聚焦 peer 的只读输入边界 |

### peer-reload.spec.ts（留 1/1）

| 测试                                                                        | 类  | 守的链路                                             |
| --------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| a finished peer keeps its place, read-only view and way back after a reload | ④   | 刷新后已完成的协作者保留位置、只读视图和回主会话入口 |

### plan-card.spec.ts（留 1/3）

| 测试                                                                    | 类  | 守的链路                                            |
| ----------------------------------------------------------------------- | --- | --------------------------------------------------- |
| shows the plan, replaces it wholesale, and clears it when the turn ends | ①   | 计划卡呈现/整体替换/回合结束清除（键盘/门控变体删） |

### product.spec.ts（留 19/32）

| 测试                                                                                         | 类  | 守的链路                                                                                      |
| -------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------- |
| keeps authentication when a remembered Session can no longer open                            | ④   | 记忆会话打不开时认证不回退                                                                    |
| keeps a server-accepted turn and sibling records on the same pooled socket                   | ④   | 已接受回合与兄弟记录共用单池 socket                                                           |
| keeps B selected when A's unacknowledged start is rejected                                   | ④   | A 未确认启动被拒时 B 保持选中（held-start 竞态族代表）                                        |
| reports a start acknowledgement timeout as unknown, then settles on release                  | ④   | 启动确认超时先 unknown 后落定                                                                 |
| recovers A's held start with a plain turn while B stays selected and unopened（整张 4 行表） | ②/④ | A 的启动被挂起时恢复，B 保持选中且不重开；4 行表同时守恢复准入的审批显示 Waiting（#394 合并） |
| does not project ambiguous legacy Session rows into a Workspace                              | ④   | 歧义旧行不投影进工作区（数据完整性）                                                          |
| lists a workspace's server-attested history in a fresh tab and opens a row it never opened   | ①   | 新标签页列出服务器背书历史并打开未开过行                                                      |
| moves drafts only after a profile-choice Session transition commits                          | ④   | profile 选择过渡提交后才移动草稿                                                              |
| restores the origin, tab credential, session, and workspace after refresh                    | ④   | 刷新恢复 origin/凭据/会话/工作区四元组                                                        |
| offers whole permission presets and confirms full access                                     | ③   | 权限整档预设 + 完全访问确认                                                                   |
| separates the Session runtime from the Profile default model                                 | ②   | 会话运行时与 profile 默认模型分离（跨功能）                                                   |
| owns plan and background work under the active session Trajectory                            | ②   | 计划与后台工作归属活动会话 Trajectory                                                         |
| does not expose implementation and diagnostic concepts as product IA                         | ⑤   | 实现/诊断概念不进产物 IA 的设计边界                                                           |
| sends prompts without presenting billed input usage as context occupancy                     | ⑤   | 计费输入不冒充上下文占用的诚实性设计                                                          |
| recovers the durable session after disconnect and lossy replay                               | ④   | 断线 + 有损重放后的持久会话恢复                                                               |
| resolves approval and structured-question takeovers                                          | ②   | 审批与结构化问题接管                                                                          |
| onboards an empty solo server from workspace creation                                        | ①   | 空 solo 服务器从建工作区起步（自动激活变体删）                                                |
| preserves Octoscode keyless-provider onboarding semantics                                    | ⑤   | 无 key provider 入门语义的设计例外                                                            |
| keeps the DSH-aligned dark product shell WCAG A/AA clean                                     | ⑤   | axe 门禁：暗色产物壳 WCAG A/AA（keyboard/semantics 与 skip-link 变体删）                      |

### profile-mutation.spec.ts（留 2/2）

| 测试                                                                                                                           | 类  | 守的链路                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------- |
| skill removal holds the profile lock through deferred replies and deduplicates confirmation; reviewing a source writes nothing | ④   | profile 锁贯穿延迟应答 + 确认去重，评审来源不写入（并发/完整性） |
| a failed credential write clears its input, consumes confirmation and requires a fresh review                                  | ③   | 凭据写失败清输入、需重新评审（安全）                             |

### resume-and-reasoning.spec.ts（留 4/4）

| 测试                                                                                                   | 类  | 守的链路                                         |
| ------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------ |
| resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history | ③   | 恢复未验证候选需确认 + canonical 历史（安全）    |
| canceling a held historical open cannot install a late transcript or steal a new selection             | ④   | 取消后迟到的历史 transcript 不能偷新选中（竞态） |
| resuming an already retained busy historical Session never reopens or resets its turn                  | ②   | 恢复已保留的忙碌历史会话不重开不复位             |
| reasoning visibility is retained per Session and does not change captured model effort                 | ②   | reasoning 可见性按会话保留、不改模型 effort 记录 |

### runtime-recovery.spec.ts（留 1/4）

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

### session-panel.spec.ts（留 3/12）

| 测试                                                                 | 类  | 守的链路                                          |
| -------------------------------------------------------------------- | --- | ------------------------------------------------- |
| Files ignores a late listing from the previous workspace root        | ④   | 切换后，上一个工作区根迟到的列表被忽略            |
| one file stays selected across diff, output, reload and read failure | ②   | 同一个文件在 diff、输出、刷新和读失败之间保持选中 |
| Files browses the real workspace tree and previews any file in it    | ①   | 侧栏浏览真实工作区树并预览任意文件                |

### settings-memory.spec.ts（留 2/4）

| 测试                                                                              | 类  | 守的链路                                            |
| --------------------------------------------------------------------------------- | --- | --------------------------------------------------- |
| ingest → search → detail survives a page refresh, and failures stay honest        | ①   | 记忆写入、搜索、详情链熬过刷新，失败如实显示        |
| fails closed when authenticated memory ownership differs from the Session profile | ③   | 记忆归属与会话 profile 不一致时失败关闭（身份隔离） |

### settings-mobile.spec.ts（留 1/1）

| 测试                                | 类  | 守的链路                                 |
| ----------------------------------- | --- | ---------------------------------------- |
| Settings remain operable at 320×480 | ①   | 手机视口 Settings 可操作（手机独有边界） |

### simultaneous-sessions.spec.ts（留 3/4）

| 测试                                                                                             | 类  | 守的链路                                               |
| ------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------ |
| isolates independent turns across rapid Session switches                                         | ④   | 快速切换下独立回合隔离                                 |
| recovers an unacknowledged A1 behind B and drains A2 then A3 without replaying A1                | ④   | 未确认 A1 恢复 + FIFO 顺序排空不重演（drain 变体删）   |
| preserves native persisted segment finality across late deltas and the next background FIFO turn | ④   | 迟到 delta 与后台 FIFO 下原生段 finality（数据完整性） |

### skill-install-review.spec.ts（留 3/9）

| 测试                                                            | 类  | 守的链路                                 |
| --------------------------------------------------------------- | --- | ---------------------------------------- |
| reviews what the server reports, read only                      | ①   | 技能安装评审主流程（只读）               |
| a source that moves after its review never gets an install sent | ③   | 评审后来源变了，绝不发送安装（先查后用） |
| keeps sources and tokens out of browser storage                 | ③   | 来源和令牌不进浏览器存储                 |

### startup-close-error.spec.ts（留 2/6）

| 测试                                                                           | 类  | 守的链路                                   |
| ------------------------------------------------------------------------------ | --- | ------------------------------------------ |
| a 1008 launch explains the Profile and keeps the login across the reconnect    | ④   | 1008 关闭说明 Profile 原因，重连后保留登录 |
| a new Session that fails from an open one keeps both the error and the Session | ④   | 从已打开会话新建失败时，错误和原会话都保留 |

### stop-returns-attachments.spec.ts（留 1/1）

| 测试                                                                            | 类  | 守的链路                                              |
| ------------------------------------------------------------------------------- | --- | ----------------------------------------------------- |
| stopping a turn returns its prompt and files, and sending again needs no upload | ②   | 停止回合退回提示和文件，再发无需重新上传（停止×附件） |

### surface-recovery.spec.ts（留 2/5）

| 测试                                                                       | 类  | 守的链路                                                               |
| -------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------- |
| a failed model-management chunk preserves the owner, queue, draft and Stop | ④   | 失败 chunk 不丢属主/队列/草稿/停止（import 取消/Escape/review 变体删） |
| a late clipboard command result does not enter a different conversation    | ④   | 迟到剪贴板命令结果不进另一会话（竞态）                                 |

### tab-lock.spec.ts（留 1/1）

| 测试                                                                    | 类  | 守的链路                                       |
| ----------------------------------------------------------------------- | --- | ---------------------------------------------- |
| a second tab sees the lock, takes over, and the first tab sees the loss | ④   | 多标签锁：第二标签可见可接管、第一标签感知丢失 |

### takeover-layout.spec.ts（留 1/1）

| 测试                                                   | 类  | 守的链路                                   |
| ------------------------------------------------------ | --- | ------------------------------------------ |
| approval keeps the document and header stable at 390px | ①   | 窄视口接管时文档与头部稳定（手机独有边界） |

### template-interactions.spec.ts（留 1/4，另补回 task-templates.spec 1 条）

| 测试                                                                        | 类  | 守的链路                                                                                    |
| --------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------- |
| a write template blocks read-only sending and offers one-click write access | ②   | 写入型模板挡住只读发送并提供一键可写（模板×权限）                                           |
| a read-only template waits for the permission receipt before sending        | ②/③ | 只读模板等权限收窄回执到了才发；回执前再按发送也不发（模板×权限，fail-closed；T-0530 补回） |

### template-launch.spec.ts（留 1/2）

| 测试                                                                                      | 类  | 守的链路                                         |
| ----------------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| a rejected template launch retries its session identity and preserves the draft on reload | ④   | 模板启动被拒后用同一会话身份重试，刷新后草稿仍在 |

### theme.spec.ts（留 2/4）

| 测试                                                                             | 类  | 守的链路                                                  |
| -------------------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| theme choices preserve one palette across manual and system modes                | ⑤   | 手动/系统模式下单一调色板的设计例外（暗 OS 可读性变体删） |
| blocked localStorage property keeps connection, session launch, and theme usable | ④   | localStorage 被禁用时连接、开会话和主题仍可用             |

### timeline-interactions.spec.ts（留 1/1）

| 测试                                                                               | 类  | 守的链路                                               |
| ---------------------------------------------------------------------------------- | --- | ------------------------------------------------------ |
| keeps activity and reader-controlled disclosures correct across ten streamed turns | ④   | 十个流式回合上活动披露与读者控制披露正确（长流完整性） |

### turn-undo.spec.ts（留 2/10）

| 测试                                                                                      | 类  | 守的链路                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| undo puts the turn's files back, keeps the conversation and draft, redo survives a reload | ①/② | 撤销恢复文件、保留对话和草稿，重做熬过刷新；Core 拒绝的重做以原话显示且不重试；后续回合跑过后旧轮不再提供重做（撤销×后续回合；T-0530 并入） |
| another tab's undo leaves this tab's stale entry unsent and unsure                        | ④   | 另一标签页撤销后，本页过期的条目不发送、标为不确定                                                                                          |

### unfinished-flows.spec.ts（留 1/7）

| 测试                                                                                                                  | 类  | 守的链路                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a new session gets the saved permission default once, under its own id, and a refused one is reported on that session | ②/③ | 新会话按自己的 id 收到一次已存的权限默认值；被拒时在该会话失败关闭：不发 turn/start、草稿保留、别的会话不受影响，重试成功后只发一次；id 未绑定到所在 profile 的会话不发 set、保持阻止（设置×新会话×发送） |

### usage-ledger.spec.ts（留 1/5）

| 测试                                                                                      | 类  | 守的链路                                           |
| ----------------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| shows the server's totals by model, date and session, and switches without mixing results | ①   | 用量账本按模型、日期、会话显示服务器总数，切换不串 |

### workspace-browse.spec.ts（留 2/6）

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

## 整文件删除（23 个）

`artifact-preview-limits.spec.ts`、`chinese-status-copy.spec.ts`、`copy-conversation.spec.ts`、`cron-run-outcome.spec.ts`、`draft-estimate.spec.ts`、`execution-environment.spec.ts`、`execution-transparency.spec.ts`、`first-look-polish.spec.ts`、`first-open-feedback.spec.ts`、`memory-export.spec.ts`、`model-facts.spec.ts`、`onboarding-recommendations.spec.ts`、`peer-presentation.spec.ts`、`press-feedback.spec.ts`、`release-readiness.spec.ts`、`session-organize.spec.ts`、`settings-connectors-cron.spec.ts`、`settings-skills.spec.ts`、`small-ui-consistency.spec.ts`、`task-templates.spec.ts`、`template-browse.spec.ts`、`template-shortcuts.spec.ts`、`visual.spec.ts`。

`visual.spec.ts` 连同 `visual.spec.ts-snapshots/`
基线目录一起删，不更新基线求绿（lead-web 11-07）。

## 执行备注（T-0501）

- 删除时连同只为被删测试服务的 fixture、helper 和 import 一起清；非 spec 的辅助文件（如
  `fixture-session.ts`、`workspace.smoke.ts`）按剩余测试的实际引用保留。
- 参数化测试只留表中写明的变体；`product.spec.ts` 的 held-start 恢复表整张保留。
- 删后跑 `python3 wake/test-lines.py` 回填本文件「基线与预计」一节的实测数字。
- CI 检查名与分片配置不变；删空的 spec 文件是否从工作流矩阵移除由 T-0501 单独评估。
