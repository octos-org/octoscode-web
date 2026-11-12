# e2e 保留清单（第二轮，T-0569）

本清单替换第一轮（T-0500/T-0530，#412）的版本，是 e2e 目录**唯一的保留清单**。本阶段只改这份文档，不删测试，也不改产品代码。lead-web
11-11 已有条件批准（见「审批记录」），T-0570 按本清单和其中的执行顺序整批删除、合并和修剪。

判定依据 `wake/lanes/TEST-DIET.md` 的第 1–5 类：

- **① 跨系统链路**：真实 Chromium、mock 服务器和 WS 一起走的用户可感知主流程。
- **② 跨功能**：两个功能互相影响的地方（如撤销×后续回合、队列×会话切换）。
- **③ 安全边界**：每类只留一两个。
- **④ 并发、数据完整性、恢复**：帧级正确性、断线或刷新后恢复、出错不丢数据，每类留最关键的。
- **⑤ 有意设计**：改之前要二次思考的设计决定。

第二轮的删除规则：不按文件名或标题相似度删。每一条删除或合并都写明由哪条保留测试覆盖，以及两者共同会红的可观察失败；写不出共同失败的，要么说明它为什么本来就测不到网页（如只测 mock），要么留下。

## 审批记录（lead-web，11-11）

- **A 档 22 条**：同意按映射删除或并入。条件：被删测试独有的断言和负例，必须先落进保留测试，并做变异证明（故意弄坏产品代码，保留测试会红），然后才删。点名的有：`session/open`
  的身份（`profile_id`）、`selected_labels` 负载、单连接
  `peak() <= 1`、令牌实际发往的目的地、`applied:false`，以及各条独有的负例。逐项清单见「T-0570 执行备注」。
- **B 档**：同意删 5 条，即 product 三条、theme 调色板、takeover-layout。**不删**
  final-reading「code copy reports rejected and missing clipboard APIs without
  losing the
  code」：剪贴板 API 被拒和缺失两种负例，加上代码保留，是真实的失败恢复。可以保留或合并，但两种负例都不能丢。
- **两个大小上限必补**：T-0570 第一步先补，再做删除。一是 artifact-preview，超限文件不预览、仍可下载；二是 attachment-drafts，上传上限。
- T-0570 等本清单合入后才开。

## 基线

- **main**：`d67c1d46bcdd6bda6b00433aa64443907216b936`（#437 合并后；初版基于 5e76dedc，#437 给 skill-install-review 加了 3 条安装测试，已并进本清单）。
- **`python3 wake/test-lines.py`**：
  - 全仓 30,271 行、460 个测试；
  - e2e 17,456 行、174 个（72 个 spec）；
  - packages/client 7,651；apps/web 4,236；e2e-live 928。
- **口径**：`test-lines.py` 只数
  `*.spec.ts`。`fixture-session.ts`、`turn-observers.ts`
  这类非 spec 的共享文件不计入。下表的行数按同一口径算（文件行数含末尾换行，与脚本一致）。
- **怎么算出来的**：
  - 每个 spec 用 oxc 解析，测试体按 AST 定位；
  - 删掉的测试连同只有它用到的顶层 helper 一起计（传递闭包）；
  - 全删的文件整个去掉；import 和共用部分保留。
  - 脚本和四份逐条盘点在
    `/data2/kamico/octos-dogfood/findings/T-0569/`（`predict.mjs`、`families.mjs`、`inventory-*.md`）。

## 结论和预测

| 阶段          | 内容                                                                                                          | e2e 行数                                                    | 测试 | 全仓          |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---- | ------------- |
| 现在          | —                                                                                                             | 17,456                                                      | 174  | 30,271        |
| A             | 删或合并 22 条重复，被并入的保留测试加约 115 行断言                                                           | 约 15,890（脚本 15,779 + 115）                              | 152  | 约 28,710     |
| A+B           | 再删 5 条只测文案、外观、布局的（final-reading 的剪贴板失败测试按批复保留）                                   | 约 15,700（脚本 15,580 + 115）                              | 147  | 约 28,520     |
| + 修剪        | 保留测试里的死代码、只看 mock 的断言、不断言的截图、参数变体；两个大小上限按批复补上（e2e 约 +8，单测约 +10） | 约 15,060（估约 −650，+8）                                  | 147  | 约 27,890     |
| + 共享 helper | 1,917 行本地副本收进共享模块（见下文）                                                                        | **约 13,760**（估约 −1,300；共享模块另增约 400 行，不计入） | 147  | **约 26,590** |
| T-0570 实测   | 以上全部做完，另补两个大小上限、加固 7 条                                                                     | **13,221**                                                  | 147  | **26,059**    |

- A 和 A+B 两行是脚本按 AST 算的；修剪和共享 helper 两行是按逐条盘点估的。最后一行是 T-0570 的实测，见「T-0570 执行结果」。
- **到不了 8–10K。**
  保留的 147 条测试体本身（含各自独占的 helper）约 11,400 行，修剪后约 10,750；再加每个文件的 import 和共用部分，就是上面的 13K 多。要到 8–10K，还得再删 25–40 条各自守着不同链路的测试，按 TEST-DIET「不为凑数字删真正守着东西的测试」，这里不删。
- 最大的保留测试和它独有的东西：

| 测试                                                                  | 行  | 为什么不能拆或删                                                                                                |
| --------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------- |
| final-reading「360-message history…」                                 | 333 | 唯一的长历史阅读测试：流式输出时读者不被拽走、Back to latest、不安全 Markdown 惰性。T-0570 删掉不断言的视口循环 |
| capacity-and-peers                                                    | 306 | 12 个浏览器回合 + 3 个原生 peer 共用一个 socket；也是会话隔离的超集（吃掉 simultaneous 第一条）                 |
| multi-session-recovery-soak「parks a background approval…」           | 304 | 后台审批跨 A/B/C 切换停在所属会话，排队消息只排空一次，断线后还在。T-0570 删约 50 行只看 fixture 的断言         |
| interaction-ownership「keeps three concurrent parked questions…」     | 279 | 三个会话的问题乱序回应，id 精确。吃掉同文件第二条                                                               |
| command-surface「queues a held gather synthesis…」                    | 193 | 忙碌的 A 上排队 gather 合成而 B 被选中，blackboard 刷新只读                                                     |
| usage-ledger                                                          | 190 | 用量账本按模型、日期、会话切换不串；令牌只走 bearer、不进 URL                                                   |
| peer-activity-and-restore「the peer dock follows…」                   | 187 | peer dock 状态机 idle→live→blocked→live→done，审批 fail-closed                                                  |
| simultaneous-sessions「preserves native persisted segment finality…」 | 174 | 迟到的 delta 不改已持久化的段落                                                                                 |
| runtime-recovery                                                      | 174 | 唯一的「回合结果未知」路径：不重放、不报已停止、队列和新草稿都在                                                |

## 第 3 类的五个子类

| 子类             | e2e 里守它的测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径穿越         | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 判定在 Core。网页只如实显示 Core 的结果：workspace-browse「browses the server's folders…」（服务器隐藏的项照实报告）、session-links「refuses a saved-link candidate with a different workspace…」（工作区不符的链接在请求历史前就拒）。网页侧解码由 packages/client 单测 `session-files.test.ts`「rejects malformed entries and workspace escapes instead of showing them」守                                                                                                                                                                                                                                                                                                                                                                       |
| 沙箱逃逸         | artifact-preview「keeps HTML and SVG scripts and network access inert」、final-reading「360-message history…」（不安全 Markdown）、mobile-remote「a sandbox escalation can only be denied from the phone」、connector-management「adds a stdio connector from the server's allowlist, never a command」                                                                                                                                                                                                             | 预览和 Markdown 不执行脚本、不发网络请求；手机不能批准越出沙箱；stdio 连接器只能选白名单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 鉴权和权限       | auth-identity「rejects invalid auth…」、approval-clarity 三条、product「offers whole permission presets…」、interaction-ownership「rejects same-base foreign-topic approval…」、session-links 两条、settings-memory「fails closed when authenticated memory ownership differs…」、template-interactions 两条、unfinished-flows、mobile-handoff 两条（含并入的 handoff-origin）                                                                                                                                      | auth-identity 第二、三条删或并入，理由见表：第二条只测 mock，第三条与 product 同链                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 密钥和令牌脱敏   | connection-storage「closed-tab drafts restore only for the authenticated principal…」、profile-mutation「a failed credential write…」、connector-oauth「signs a connector in…」、skill-install-review「keeps sources and tokens out of browser storage」、pairing-link「the paired token survives only this tab until Forget」、usage-ledger（令牌不进 URL）、onboarding「explains missing authentication while preserving password privacy…」、scanned-pdf「renders black-and-white…」（识别出的文字不进任何存储） | model-management 第二条删：mock 从不回显密钥，那条「脱敏」断言不会红                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 外部输入大小上限 | hydrate-failure「a cold hydrate failure stays honest…」（服务器的 `response_bytes_limit` 拒绝如实显示，重试不留幽灵会话）                                                                                                                                                                                                                                                                                                                                                                                           | 网页侧的上限在单测：packages/client `external-driver-operations.test.ts`「bounds the page on EXACT RAW snake_case serialization (256KiB)」、`projection-inputs.test.ts`「bounds numeric payload fields…」、`history.test.ts`「rejects invalid topic bytes and out-of-range u32 counts…」。**缺口两处**：一是预览的文件大小上限（`ArtifactPreview.tsx`「too large to preview here」），第一轮随 `artifact-preview-limits.spec.ts` 删了；二是上传的大小上限（`attachment-drafts.ts` 的 `MAX_UPLOAD_BYTES`/`MAX_IMAGE_BYTES`）。两处现在 e2e 和单测都没有。lead-web 11-11 定为必补，是 T-0570 的第一步：artifact-preview 第一条补一步，交付一个超限文件，断言不预览、仍可下载（约 +8 行）；`attachment-drafts.test.ts` 补一条上传上限单测（约 +10 行） |

## 逐问：两个功能交叉的链路

| 交叉               | 守它的测试（全部保留）                                                                                                                                                                                     | 结论                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模板×权限          | template-interactions「a write template blocks read-only sending…」「a read-only template waits for the permission receipt…」；template-launch「a rejected template launch retries its session identity…」 | 写模板在只读会话被拦并给一键提权；只读模板等权限回执再发。不缺                                                                                                                                                                      |
| 撤销×后续          | turn-undo「undo puts the turn's files back…」（Core 拒绝的重做不重试，后续回合跑过后旧轮不再提供重做）、「another tab's undo…」；command-surface「keeps the rewind receipt…」                              | 不缺                                                                                                                                                                                                                                |
| OAuth×刷新         | connector-oauth 三条                                                                                                                                                                                       | 第三条原标题说「直到服务器确认 connected」，但从没让服务器确认 connected；T-0570 改名为「a restart-pending sign-in keeps its restart note across refreshes」，与断言一致                                                            |
| 记忆×版本冲突      | settings-memory「long-term entries edit and delete on the server…」                                                                                                                                        | 另一个写入者改过后保存被拒，显示服务器版本，草稿保留，再存成功；服务器没确认时草稿也保留。不缺                                                                                                                                      |
| PWA×重连           | hydrate-failure「a failed reconnect hydrate retains…」、surface-recovery「a failed model-management chunk…」                                                                                               | 产品没有 service worker（`apps/web/src` 无 `serviceWorker`），没有离线缓存那一层。对应风险是「服务器换了构建 × 断线重连」：前者守重连 hydrate 失败不丢会话、Changes 和草稿，后者守新构建下懒加载分块失败不丢队列、草稿和 Stop。不缺 |
| 预览×取消/敏感缓存 | scanned-pdf 两条、artifact-preview 两条、delivered-files                                                                                                                                                   | 取消或收起识别会结束线程，不冒迟到结果；识别文字和 PDF 内容不进 Cache Storage、IndexedDB、web storage；预览脚本惰性                                                                                                                 |

其余交叉（权限×运行中回合、队列×会话切换、中断×附件、peer×只读输入框、新会话×权限默认值等）见下表各行的「守的链路」。

## 逐问：失败和迟到路径

| 路径                 | 守它的测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied:false` 回执 | approval-clarity「permission retry requires an applied workspace-write response」：与「refuses a response that broadens…」合成一个表驱动测试，`applied:false` 仍是表中一行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 跨代次、迟到应答     | approval-clarity「a late permission retry…」、product「keeps B selected when A's unacknowledged start is rejected」和 held-start 表、resume-and-reasoning「canceling a held historical open…」、simultaneous-sessions「recovers an unacknowledged A1…」、connector-oauth「a sign-in returning after the page was refreshed…」、driver-discovery A/B 和 reconnect 两条、native-workflows 第三至五条、chat-handover「a late collision…」、command-surface「queues a held gather synthesis…」、surface-recovery「a late clipboard command result…」、cron「creates At, Every and Cron jobs…」最后一步（换会话关掉定时任务页，T-0586）、diff-review「Changes works before a turn…」 |
| 写入结果不明         | runtime-recovery、product「reports a start acknowledgement timeout as unknown…」、server-shutdown（`{}` 结果报未确认）、memory-import「a reply lost after the server wrote the batch…」、settings-memory「long-term entries edit and delete…」、turn-undo「another tab's undo…」、skill-install-review「an unconfirmed install is re-read from the server, never claimed」                                                                                                                                                                                                                                                                                                      |
| 写入被拒             | turn-undo 第一条、chat-handover 第一条、peer-controller「a refused dispatch…」、peer-control 拒绝回执和 fence stale 两条、template-launch、mobile-remote「a phone starts a new session… keeps a refused first task as a draft」、profile-mutation「a failed credential write…」、unfinished-flows、skill-install-review「a changed registry refuses the install and nothing else happens」                                                                                                                                                                                                                                                                                      |
| 旧令牌清理           | 旧 localStorage 令牌的清理在 apps/web 单测 `connection/remembered-token.test.ts`「removes saved tokens for every origin without changing preferences」（T-0529）；e2e 里是 connection-storage「closed-tab drafts…」（Forget 清掉该身份）和 pairing-link「the paired token survives only this tab until Forget」                                                                                                                                                                                                                                                                                                                                                                 |

上表里 cron、diff-review、session-panel、surface-recovery 这四条迟到测试缺同步点或缺正向对照，可能空过。T-0570 做了变异核实：diff-review 本来就会红；surface-recovery 补了正向对照；cron 和 session-panel 补了同步点，但守卫从 UI 走不到，留给 lead 下一轮定（见「T-0570 执行结果」）。

## PDF、手机、旧 Core 的负例（全部保留）

- **PDF**：scanned-pdf 两条（黑白和 JPEG
  2000 扫描件、本地识别、服务器不支持、取消）。
- **手机**：final-input「long approval remains readable and actionable in a
  short phone viewport」、modal-stack（320px）、workspace-ux「keeps the mobile
  composer on
  screen…」、settings-mobile（320×480）、mobile-handoff 两条、mobile-remote 第三至七条。takeover-layout（B 档，已批）删后，手机上长审批的可读和可操作仍由 final-input 守。
- **旧 Core**（不广播某能力时的退路）：workspace-browse「shows no Browse
  affordance…」、session-panel「Files ignores a late
  listing…」（旧 Core 的 Files 回退）、native-workflows「native commands fail
  closed when the original fixture does not advertise them」、peer-control「no
  seat panel when external_driver_v1 is unadvertised」、product「does not
  project ambiguous legacy Session rows…」。

## 每个 spec 的行数

「A 后」「A+B 后」是脚本结果，不含被并入测试新增的约 115 行，也不含修剪和共享 helper。「留」按 A+B 算。

| spec                                | 现行数    | 测试    | A 后      | A+B 后    | 留      |
| ----------------------------------- | --------- | ------- | --------- | --------- | ------- |
| approval-clarity.spec.ts            | 143       | 4       | 128       | 128       | 3       |
| artifact-preview.spec.ts            | 69        | 2       | 69        | 69        | 2       |
| attention.spec.ts                   | 191       | 2       | 190       | 190       | 2       |
| auth-identity.spec.ts               | 233       | 3       | 63        | 63        | 1       |
| canonical-recovery.spec.ts          | 163       | 1       | 163       | 163       | 1       |
| capacity-and-peers.spec.ts          | 319       | 1       | 319       | 319       | 1       |
| chat-handover.spec.ts               | 273       | 2       | 273       | 273       | 2       |
| command-surface.spec.ts             | 403       | 3       | 403       | 403       | 3       |
| composer-bar.spec.ts                | 168       | 2       | 168       | 168       | 2       |
| composer-skill-actions.spec.ts      | 97        | 1       | 97        | 97        | 1       |
| connection-storage.spec.ts          | 214       | 2       | 214       | 214       | 2       |
| connector-management.spec.ts        | 198       | 3       | 198       | 198       | 3       |
| connector-oauth.spec.ts             | 210       | 3       | 210       | 210       | 3       |
| conversation-search.spec.ts         | 34        | 1       | 34        | 34        | 1       |
| cron-create-delete.spec.ts          | 385       | 4       | 343       | 343       | 3       |
| delivered-files.spec.ts             | 119       | 1       | 119       | 119       | 1       |
| diff-review.spec.ts                 | 367       | 3       | 367       | 367       | 3       |
| draft-recovery.spec.ts              | 37        | 1       | 37        | 37        | 1       |
| driver-discovery.spec.ts            | 508       | 6       | 449       | 449       | 3       |
| expert-teams.spec.ts                | 276       | 3       | 234       | 234       | 2       |
| final-input.spec.ts                 | 99        | 2       | 99        | 99        | 2       |
| final-reading.spec.ts               | 459       | 2       | 459       | 459       | 2       |
| handoff-origin.spec.ts              | 69        | 1       | 0         | 0         | 0       |
| hydrate-failure.spec.ts             | 178       | 2       | 178       | 178       | 2       |
| interaction-ownership.spec.ts       | 683       | 3       | 625       | 625       | 2       |
| keyboard-parity.spec.ts             | 188       | 2       | 188       | 188       | 2       |
| loaf.spec.ts                        | 78        | 1       | 78        | 78        | 1       |
| local-preferences.spec.ts           | 258       | 2       | 258       | 258       | 2       |
| memory-import.spec.ts               | 265       | 2       | 265       | 265       | 2       |
| mobile-handoff.spec.ts              | 125       | 2       | 125       | 125       | 2       |
| mobile-remote.spec.ts               | 616       | 7       | 548       | 548       | 6       |
| modal-a11y.spec.ts                  | 38        | 1       | 0         | 0         | 0       |
| modal-stack.spec.ts                 | 87        | 1       | 87        | 87        | 1       |
| model-management.spec.ts            | 248       | 3       | 214       | 214       | 2       |
| multi-session-fence-soak.spec.ts    | 506       | 1       | 0         | 0         | 0       |
| multi-session-recovery-soak.spec.ts | 755       | 2       | 523       | 523       | 1       |
| native-fleet.spec.ts                | 84        | 1       | 84        | 84        | 1       |
| native-workflows.spec.ts            | 623       | 5       | 623       | 623       | 5       |
| onboarding.spec.ts                  | 119       | 3       | 119       | 119       | 3       |
| pairing-link.spec.ts                | 96        | 2       | 76        | 76        | 1       |
| peer-activity-and-restore.spec.ts   | 328       | 2       | 267       | 267       | 1       |
| peer-control.spec.ts                | 276       | 4       | 276       | 276       | 4       |
| peer-controller.spec.ts             | 369       | 2       | 369       | 369       | 2       |
| peer-readonly-composer.spec.ts      | 216       | 1       | 216       | 216       | 1       |
| peer-reload.spec.ts                 | 152       | 1       | 152       | 152       | 1       |
| plan-card.spec.ts                   | 108       | 1       | 108       | 108       | 1       |
| product.spec.ts                     | 1222      | 19      | 1186      | 1108      | 15      |
| profile-mutation.spec.ts            | 279       | 2       | 279       | 279       | 2       |
| resume-and-reasoning.spec.ts        | 372       | 4       | 372       | 372       | 4       |
| runtime-recovery.spec.ts            | 178       | 1       | 178       | 178       | 1       |
| scanned-pdf.spec.ts                 | 149       | 2       | 149       | 149       | 2       |
| server-shutdown.spec.ts             | 103       | 1       | 103       | 103       | 1       |
| session-links.spec.ts               | 185       | 2       | 185       | 185       | 2       |
| session-panel.spec.ts               | 269       | 3       | 269       | 269       | 3       |
| settings-memory.spec.ts             | 217       | 3       | 217       | 217       | 3       |
| settings-mobile.spec.ts             | 114       | 1       | 114       | 114       | 1       |
| simultaneous-sessions.spec.ts       | 506       | 3       | 384       | 384       | 2       |
| skill-install-review.spec.ts        | 450       | 6       | 424       | 424       | 5       |
| startup-close-error.spec.ts         | 122       | 2       | 100       | 100       | 1       |
| stop-returns-attachments.spec.ts    | 75        | 1       | 75        | 75        | 1       |
| surface-recovery.spec.ts            | 158       | 2       | 158       | 158       | 2       |
| tab-lock.spec.ts                    | 80        | 1       | 80        | 80        | 1       |
| takeover-layout.spec.ts             | 71        | 1       | 71        | 0         | 0       |
| template-interactions.spec.ts       | 75        | 2       | 75        | 75        | 2       |
| template-launch.spec.ts             | 88        | 1       | 88        | 88        | 1       |
| theme.spec.ts                       | 133       | 2       | 133       | 83        | 1       |
| timeline-interactions.spec.ts       | 154       | 1       | 154       | 154       | 1       |
| turn-undo.spec.ts                   | 278       | 2       | 278       | 278       | 2       |
| unfinished-flows.spec.ts            | 170       | 1       | 170       | 170       | 1       |
| usage-ledger.spec.ts                | 216       | 1       | 216       | 216       | 1       |
| workspace-browse.spec.ts            | 109       | 2       | 109       | 109       | 2       |
| workspace-ux.spec.ts                | 253       | 4       | 197       | 197       | 3       |
| **合计**                            | **17456** | **174** | **15779** | **15580** | **147** |

## 保留清单（逐条）

「行」= 测试体行数，+ 号后是只被它用到的 helper 行数。「决定」：留；留（收并入）=
T-0570 要把别的测试的断言并进来；留（T-0570 已加固 / 已调整 / 改标题）、留（待 lead 定）= 见「T-0570 执行结果」；删(A)/并入(A)
= 重复，有映射；删(B，已批) = 只测文案、外观或布局，lead-web 11-11 批准删。

### approval-clarity.spec.ts（4 个，留 3；143 行 → A 后 128）

| 测试                                                                              | 类  | 行  | 决定                | 守的链路 / 删除映射                                                                                                                                      |
| --------------------------------------------------------------------------------- | --- | --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| switching stops the running workaround, then redoes the request with write access | ②   | 42  | 留                  | 拒写后切到可写：先停掉正在跑的变通回合，再按原请求重做（权限×运行中回合）                                                                                |
| a late permission retry never starts in or clears another Session                 | ④   | 24  | 留                  | 迟到的权限重试不在别的会话启动、也不清别的会话                                                                                                           |
| permission retry refuses a response that ${answer}                                | ③   | 15  | 留（T-0570 已合并） | 表驱动两行：`broadens network access`（应答扩大网络访问）和 `is not applied`（`applied:false`）。两种应答都报错、不重做回合；变异核实每行各自会红        |
| permission retry requires an applied workspace-write response                     | ③   | 15  | 并入上一条(A)       | 与上一条打 App.tsx 同一个守卫（应答扩大网络或 `applied:false` → 报错、不重做回合），setup、报错文案和断言相同。合并后 `applied:false` 仍是表中一行，不丢 |

### artifact-preview.spec.ts（2 个，留 2；69 行）

| 测试                                                           | 类  | 行  | 决定 | 守的链路 / 删除映射                      |
| -------------------------------------------------------------- | --- | --- | ---- | ---------------------------------------- |
| keeps a structured write artifact and its preview after reload | ①   | 19  | 留   | 写入产物与预览在刷新后仍在               |
| keeps HTML and SVG scripts and network access inert            | ③   | 41  | 留   | 预览中的 HTML/SVG 脚本和网络访问保持惰性 |

### attention.spec.ts（2 个，留 2；191 行 → A 后 190）

| 测试                                                                                         | 类  | 行    | 决定 | 守的链路 / 删除映射                                |
| -------------------------------------------------------------------------------------------- | --- | ----- | ---- | -------------------------------------------------- |
| denied desktop permission keeps tab counts working and Disconnect clears attention           | ③   | 35+1  | 留   | 桌面通知权限被拒后的降级边界（角标不依赖通知权限） |
| a background Session completing while another is selected signals and acknowledges on return | ②   | 48+12 | 留   | 跨会话注意力信号与确认（后台完成 → 选中会话提示）  |

### auth-identity.spec.ts（3 个，留 1；233 行 → A 后 63）

| 测试                                                                 | 类  | 行    | 决定    | 守的链路 / 删除映射                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | --- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rejects invalid auth before the product shell is ever mounted        | ③   | 42    | 留      | 无效凭据在产物壳挂载前被拒                                                                                                                                                                                                                                      |
| accepts a profile-routable web identity but closes a scoped mismatch | ③   | 27+64 | 删(A)   | 在 `page.evaluate` 里开裸 WebSocket，只验证 mock 自己的 scope 规则，网页代码怎么改都不会让它红，所以没有可映射的网页失败。Core 的 scope 规则由 octos 侧守；网页对 1008 关闭的呈现由 startup-close-error「a 1008 launch…」守                                     |
| binds a cross-profile launch to the resolved profile before open     | ③   | 48+31 | 并入(A) | 并入 product「moves drafts only after a profile-choice…」，两者是同一条链：Add workspace → 选 profile → Start with review。共同失败：`session/open` 没带解析出的 `profile_id`，或 `session_id` 前缀错。并入时加一个 `session/open` 观察和 4 行断言（约 +12 行） |

### canonical-recovery.spec.ts（1 个，留 1；163 行）

| 测试                                                              | 类  | 行    | 决定 | 守的链路 / 删除映射                                                      |
| ----------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------------------------------ |
| refresh shows the interrupted turn with complete canonical replay | ④   | 158+1 | 留   | 刷新后中断回合按 canonical replay 呈现，不重演（legacy terminal 变体删） |

修剪（T-0570，不删测试）：`recoveryModuleRequests > 0`（依赖懒加载分块的实现细节）

### capacity-and-peers.spec.ts（1 个，留 1；319 行）

| 测试                                                                                   | 类  | 行     | 决定 | 守的链路 / 删除映射                                 |
| -------------------------------------------------------------------------------------- | --- | ------ | ---- | --------------------------------------------------- |
| holds twelve browser turns and three browser-started native peers on one pooled socket | ④   | 259+47 | 留   | 单池 socket 上的容量不变量（12 回合 + 3 原生 peer） |

修剪（T-0570，不删测试）：诊断块（201–223）只留「start 已到达」一句

### chat-handover.spec.ts（2 个，留 2；273 行）

| 测试                                                                                                                                                         | 类  | 行    | 决定 | 守的链路 / 删除映射                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ----- | ---- | --------------------------------------------------------------- |
| §5.2 composer handover (external-held session) › a refused Resume chat can be retried, and Resume chat and an owned seat release control before sending once | ②   | 84+46 | 留   | 被拒的 Resume chat 可重试，恢复后与自有座席一起一次性归还发送权 |
| a late collision cannot replace newer text or images, then restores the complete draft                                                                       | ④   | 64+32 | 留   | 迟到的交接不能覆盖更新的草稿（竞态恢复）                        |

### command-surface.spec.ts（3 个，留 3；403 行）

| 测试                                                                                                     | 类  | 行    | 决定 | 守的链路 / 删除映射                                         |
| -------------------------------------------------------------------------------------------------------- | --- | ----- | ---- | ----------------------------------------------------------- |
| fails closed for an unknown command and sends no model input                                             | ⑤/③ | 15+9  | 留   | 未知命令 fail-closed、永不进模型（仓库 AGENTS.md 架构规则） |
| keeps the rewind receipt and restores only the owning prompt draft after canonical refresh               | ④   | 67+51 | 留   | 回执经 canonical 刷新保留 + 草稿归属恢复                    |
| queues a held gather synthesis only on busy A while B is selected and keeps blackboard refresh read-only | ②   | 190+3 | 留   | gather 合成在忙碌会话排队、黑板刷新只读（跨功能）           |

修剪（T-0570，不删测试）：第三条末尾的 64 KiB 断言量的是测试自己拼的字符串，删

### composer-bar.spec.ts（2 个，留 2；168 行）

| 测试                                                                            | 类  | 行    | 决定 | 守的链路 / 删除映射                             |
| ------------------------------------------------------------------------------- | --- | ----- | ---- | ----------------------------------------------- |
| another folder starts a new session that keeps the unsent text                  | ②   | 31    | 留   | 换文件夹开新会话时保留未发送文字（工作区×草稿） |
| sending waits for uploads, then carries the files and shows them on the message | ①   | 68+55 | 留   | 发送等上传完成，文件随消息送出并显示在消息上    |

修剪（T-0570，不删测试）：`offerSkills`
和取消分支等第一轮留下的死代码（约 45 行）

### composer-skill-actions.spec.ts（1 个，留 1；97 行）

| 测试                                                                                                             | 类  | 行    | 决定 | 守的链路 / 删除映射                                                       |
| ---------------------------------------------------------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------------------------------- |
| runs a skill action from the composer, retries a failed job into a new job, and tracks the jobs across a refresh | ①   | 73+18 | 留   | 从输入区运行技能动作，失败重试成新 job，刷新后 job 仍可追踪（手机变体删） |

### connection-storage.spec.ts（2 个，留 2；214 行）

| 测试                                                                                            | 类  | 行    | 决定                | 守的链路 / 删除映射                                                                                                            |
| ----------------------------------------------------------------------------------------------- | --- | ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| closed-tab drafts restore only for the authenticated principal and Forget clears that principal | ③   | 68+28 | 留                  | 草稿只归还给认证主体；Forget 清主体（身份隔离）                                                                                |
| a 51st unsent draft evicts one older draft, stays saved, and never blocks navigation            | ④   | 82+1  | 留（T-0570 改标题） | 草稿容量逐出且不阻塞导航（数据完整性）。逐出哪一条取决于 localStorage 枚举顺序，e2e 只能断言「逐出了一条」，标题改为与断言一致 |

### connector-management.spec.ts（3 个，留 3；198 行）

| 测试                                                                     | 类  | 行  | 决定                | 守的链路 / 删除映射                                                                     |
| ------------------------------------------------------------------------ | --- | --- | ------------------- | --------------------------------------------------------------------------------------- |
| manages HTTP connectors and keeps existing stdio controls                | ①   | 51  | 留                  | 连接器管理主流程                                                                        |
| adds a stdio connector from the server's allowlist, never a command      | ③   | 38  | 留                  | stdio 连接器只能从服务器白名单选，不能填命令                                            |
| a delayed refresh blocks mutations and releases busy state when it lands | ④   | 48  | 留（T-0570 改标题） | 延迟的刷新期间禁止变更、应答到达后释放 busy。只测成功释放，标题去掉「always」与断言一致 |

修剪（T-0570，不删测试）：`openConnectors` 的中文和窄屏分支、`start` 的 `stable`
参数已无调用者（约 15 行）

### connector-oauth.spec.ts（3 个，留 3；210 行）

| 测试                                                              | 类  | 行    | 决定                | 守的链路 / 删除映射                                                                                                                                                                                |
| ----------------------------------------------------------------- | --- | ----- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| signs a connector in through the provider and back                | ①   | 88+23 | 留                  | 连接器 OAuth 登录往返主流程                                                                                                                                                                        |
| a sign-in returning after the page was refreshed is turned away   | ③   | 36    | 留                  | 页面刷新后回来的登录回跳被拒（state 不跨刷新）                                                                                                                                                     |
| a restart-pending sign-in keeps its restart note across refreshes | ④   | 34    | 留（T-0570 改标题） | 需重启的登录在刷新间保留「重启后生效」提示，不倒回「需要授权」（OAuth×刷新）。原标题说「直到服务器确认已连接」，但 fixture 没有能模拟重启后已连接的开关，测试从没测过这一步，所以改标题，不扩 mock |

### conversation-search.spec.ts（1 个，留 1；34 行）

| 测试                                                                     | 类  | 行   | 决定                | 守的链路 / 删除映射                                                                                                            |
| ------------------------------------------------------------------------ | --- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ⌘F opens the search bar over an open session and matches transcript text | ①   | 15+8 | 留（T-0570 已加固） | ⌘F 打开搜索并匹配对话文字（唯一的搜索覆盖）。计数改成精确的 `1/N`，加「搜不到的文字显示 0」负向对照；零匹配显示 1/1 的变异会红 |

### cron-create-delete.spec.ts（4 个，留 3；385 行 → A 后 343）

| 测试                                                                 | 类  | 行    | 决定         | 守的链路 / 删除映射                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| creates At, Every and Cron jobs, then deletes one after confirmation | ①   | 116+5 | 留（收并入） | 定时任务三种类型创建 + 确认后删除。T-0570 并入「uses the current session scope…」的逐帧 `session_id` 断言和一次 toggle。T-0586 加最后一步：新建会话会关掉定时任务页，迟到的 cron 应答因此落不到别的会话；去掉 App 换会话时关路由的 effect 会红                            |
| uses the current session scope for list, toggle, create and delete   | ③   | 42    | 并入(A)      | 并入 cron「creates At, Every and Cron jobs…」。它只有一个会话，从没测过隔离。共同失败：list、toggle、create、delete 没带当前会话的 scope。并入一次 toggle 和逐帧 `session_id` 断言（约 +6 行）                                                                            |
| ignores a late create response after the session view changes        | ④   | 35    | 删（T-0586） | 从 UI 走不到：换会话时 App 的 effect 关掉定时任务页，页面卸载，它的写入都只进页面自己的状态。只去掉页面的 generation 守卫仍绿；只去掉关路由的 effect 也仍绿（守卫兜住）；两层都去掉才红。真正的保护（换会话关页）改由「creates At, Every and Cron jobs…」最后一步直接断言 |
| shows how each run really went and opens the run it points at        | ②   | 131   | 留           | 定时运行结果如实显示，并能打开它指向的会话回合（定时×会话）                                                                                                                                                                                                               |

修剪（T-0570，不删测试）：第一条的 2099 年、Weekly 两个参数变体（同一条创建链换参数）

### delivered-files.spec.ts（1 个，留 1；119 行）

| 测试                                                                                      | 类  | 行     | 决定 | 守的链路 / 删除映射                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | --- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shows files the agent delivers, previews images, downloads them, and keeps them on reload | ①/④ | 100+10 | 留   | 产物投递 → 预览/下载 → 刷新保留主流程；原文件读不到且无交付时大小时，预览从 `.artifacts/delivered/` 交付时快照取大小（T-0530 并入，原 artifact-preview 一条） |

### diff-review.spec.ts（3 个，留 3；367 行）

| 测试                                                                                 | 类  | 行    | 决定 | 守的链路 / 删除映射                                                                                                            |
| ------------------------------------------------------------------------------------ | --- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| diff syntax and word marks keep inert, selectable text beside the chat and on mobile | ③   | 91+96 | 留   | diff 渲染保持惰性可选（不安全内容不可执行）。T-0570 修剪了主题配色比较和截图，标题随之去掉「both themes」                      |
| Changes works before a turn and ignores a late workspace reply after changing scope  | ②/④ | 70    | 留   | 无回合时 Changes 可用；切换范围后迟到的工作区应答被忽略。变异核实：去掉 `requestIsCurrent()` 检查 3 次都红，不是空过，测试不改 |
| reconnects preserve the selected preview and Git scope without new diff reads        | ④   | 82    | 留   | 重连保留选中的预览和 Git 范围，不重复读 diff                                                                                   |

修剪（T-0570，不删测试）：`openReview` 的 `recover`/`unreadableHistory`
分支已无调用者（约 25 行）；第一条里的主题/外观断言（约 25 行），保留惰性和可选中两项

### draft-recovery.spec.ts（1 个，留 1；37 行）

| 测试                                                                                   | 类  | 行  | 决定 | 守的链路 / 删除映射                        |
| -------------------------------------------------------------------------------------- | --- | --- | ---- | ------------------------------------------ |
| reload restores exact unsent text without dispatching it, and sent drafts stay cleared | ④   | 33  | 留   | 刷新恢复未发送草稿且不派发（失败写变体删） |

### driver-discovery.spec.ts（6 个，留 3；508 行 → A 后 449）

| 测试                                                                                                                                                | 类  | 行    | 决定  | 守的链路 / 删除映射                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| external driver discovery (synthetic fixture) › renders a healthy EXTERNAL disclosure from the real empty terminal operations page                  | ①   | 52+15 | 留    | 外部驱动发现：真实终端操作页 → 健康披露                                                                                                                                                                    |
| external driver discovery (synthetic fixture) › holds ONLY the first walk of a workspace: same-workspace sibling completes while A stays held       | ④   | 31    | 删(A) | 被「A/B: exact synthetic driver ID…」包含：setup 相同，网页侧断言全在那条里。共同失败：同工作区的第二个会话重新走一遍，或释放 A 后 B 显示 A 的结果。多出来的只断言 mock 内部的 `heldDriver`                |
| external driver discovery (synthetic fixture) › A/B: exact synthetic driver ID per selected Session; releasing held A never leaks into a selected B | ③   | 35+12 | 留    | 驱动 ID 归属选中会话，释放不跨会话泄漏                                                                                                                                                                     |
| external driver discovery (synthetic fixture) › surfaces a typed refusal and never mounts a disclosure for it                                       | ③   | 14    | 删(A) | 被「transitions healthy -> refused across a transport reconnect…」包含。共同失败：refusal 被渲染成 disclosure。其余断言是 mock 回复里的 `errorCode`/`refusalKind`；refusal 的收窄在 packages/client 单测里 |
| external driver discovery (synthetic fixture) › rejects a MALFORMED disclosure binding at the strict decode boundary                                | ④   | 14    | 删(A) | 同一解码规则已由 packages/client/tests/external-driver.test.ts「rejects unsafe wire integers without rounding u64」守。UI 后果（不挂 disclosure）与 reconnect 那条走同一个 gate                            |
| external driver discovery (synthetic fixture) › transitions healthy -> refused across a transport reconnect on the SAME record                      | ④   | 22+5  | 留    | 同一条记录在传输重连上健康→拒绝的转换（healthy→malformed 变体删）                                                                                                                                          |

修剪（T-0570，不删测试）：保留测试里断言 mock 回复字段（`errorCode`/`refusalKind`/`heldDriver`）的部分；只看 UI 和发出的帧

### expert-teams.spec.ts（3 个，留 2；276 行 → A 后 234）

| 测试                                                                                                             | 类  | 行   | 决定         | 守的链路 / 删除映射                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | --- | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| starts a team, shows each member's progress and result, and merges them here                                     | ①   | 74+2 | 留           | 专家团主流程：启动、成员进度与结果、合并回本会话                                                                                                                                                             |
| a failed member is named, a working member survives a refresh and is stopped once, and the merge leaves both out | ④   | 91   | 留（收并入） | 失败成员被点名，进行中的成员熬过刷新且只被停一次。T-0570 并入「a reconnect keeps a working member…」的断线一步                                                                                               |
| a reconnect keeps a working member working, and sends no stop by itself                                          | ④   | 42   | 并入(A)      | 并入「a failed member is named, a working member survives a refresh…」：同一守卫（恢复后工作中的成员仍在工作，不自动发 stop），只是触发方式不同（刷新 vs 断线）。并入一步 `/__test__/disconnect`（约 +8 行） |

### final-input.spec.ts（2 个，留 2；99 行）

| 测试                                                                    | 类  | 行   | 决定 | 守的链路 / 删除映射                          |
| ----------------------------------------------------------------------- | --- | ---- | ---- | -------------------------------------------- |
| approval shortcuts ignore modified keys and IME composition             | ③   | 40   | 留   | 审批快捷键忽略修饰键与 IME 组合（误触边界）  |
| long approval remains readable and actionable in a short phone viewport | ①   | 43+8 | 留   | 手机短视口审批完整可读可操作（手机独有边界） |

### final-reading.spec.ts（2 个，留 2；459 行）

| 测试                                                                                        | 类  | 行    | 决定                 | 守的链路 / 删除映射                                                                                 |
| ------------------------------------------------------------------------------------------- | --- | ----- | -------------------- | --------------------------------------------------------------------------------------------------- |
| code copy reports rejected and missing clipboard APIs without losing the code               | ④   | 49+44 | 留（lead-web 11-11） | 剪贴板 API 被拒和缺失时如实报失败，代码仍留在页面上可选中（失败恢复）。可以合并，但两种负例都不能丢 |
| 360-message history stays readable while new output streams and unsafe Markdown stays inert | ③/④ | 333   | 留                   | 长历史流式可读 + 不安全 Markdown 惰性（安全+完整性）                                                |

修剪（T-0570，不删测试）：「360-message history…」里不断言的视口循环

### handoff-origin.spec.ts（1 个，留 0；69 行 → A 后 0）

| 测试                                                                     | 类  | 行   | 决定    | 守的链路 / 删除映射                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | --- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a forged cross-origin handoff cannot select where a pasted token is sent | ③   | 51+7 | 并入(A) | 与 mobile-handoff「a handoff never auto-connects…」合成一条恶意交接测试。两者共享来源字段和报警断言；各自独有的一条都保留：令牌实际发往哪里由真实接收端核，以及不自动连接、不导入。合并后约 55 行，原来两条约 82 行 |

### hydrate-failure.spec.ts（2 个，留 2；178 行）

| 测试                                                                           | 类  | 行    | 决定 | 守的链路 / 删除映射                               |
| ------------------------------------------------------------------------------ | --- | ----- | ---- | ------------------------------------------------- |
| a failed reconnect hydrate retains the current Session, Changes and draft      | ④   | 71+11 | 留   | 重连后 hydrate 失败仍保留当前会话、Changes 和草稿 |
| a cold hydrate failure stays honest and Start retries without a phantom record | ④   | 44    | 留   | 冷启动 hydrate 失败如实显示，重试不留幽灵记录     |

### interaction-ownership.spec.ts（3 个，留 2；683 行 → A 后 625）

| 测试                                                                                                           | 类  | 行      | 决定         | 守的链路 / 删除映射                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | --- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rejects same-base foreign-topic approval and terminal traffic without settling or poisoning the ordinary owner | ③   | 101+20  | 留           | 同一基础会话下别的 topic 的审批和结束帧被拒，不结算也不污染本会话                                                                                                                                                                                                             |
| restores and resolves a parked question on its owning Session with exact ids                                   | ②   | 58      | 删(A)        | 被「keeps three concurrent parked questions…」包含：那条在 3 个会话上走同一条链（回到会话时恢复，带精确 id 回应）。共同失败：问题对话框漏到别的会话、回来后没恢复、respond 的 session/question id 错。本条的 `answers: [{selected_labels:["Full"]}]` 负载断言（1 行）并入那条 |
| keeps three concurrent parked questions bound to their Sessions and resolves them out of order                 | ④   | 130+149 | 留（收并入） | 并发挂起问题绑定归属、乱序解决不串会话。T-0570 并入「restores and resolves a parked question…」的 `answers` 负载断言；docblock 的「Browser-UNEXECUTED」过时，改掉                                                                                                             |

### keyboard-parity.spec.ts（2 个，留 2；188 行）

| 测试                                                                | 类  | 行    | 决定 | 守的链路 / 删除映射                                   |
| ------------------------------------------------------------------- | --- | ----- | ---- | ----------------------------------------------------- |
| opens, navigates, and executes the command palette by keyboard only | ①   | 63+1  | 留   | 纯键盘打开/导航/执行命令面板（其余 Alt+X 为参数变体） |
| Esc closes the palette inertly and interrupts only a live turn      | ②/③ | 45+20 | 留   | Esc 惰性关面板、只中断活动回合（Esc×中断危险边界）    |

### loaf.spec.ts（1 个，留 1；78 行）

| 测试                                             | 类  | 行    | 决定 | 守的链路 / 删除映射            |
| ------------------------------------------------ | --- | ----- | ---- | ------------------------------ |
| streaming turn stays under the long-frame budget | ④   | 46+22 | 留   | 流式回合长帧预算（性能完整性） |

### local-preferences.spec.ts（2 个，留 2；258 行）

| 测试                                                                                                                            | 类  | 行    | 决定 | 守的链路 / 删除映射                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bare Normal Escape interrupts only the selected owner, while Vim changes preserve the other busy Session                        | ②   | 37+49 | 留   | Vim Escape 只中断选中属主、不扰另一忙碌会话（跨会话键盘隔离）                                                                                                                                    |
| only explicit save persists display preferences; reload restores preferences and the separate draft without storing credentials | ⑤/③ | 66+13 | 留   | 显示偏好只在显式保存时落盘，刷新恢复偏好和独立的草稿，不存凭据（有意设计 + 凭据不落 localStorage）。其中令牌不落盘与 connection-storage 重叠、草稿刷新与 draft-recovery 重叠，这两段 T-0570 可删 |

修剪（T-0570，不删测试）：`observe` 的 `received`/`pending`/`sockets`
没人读（约 12 行）；第二条里与 connection-storage（令牌不落盘）、draft-recovery（草稿刷新）重叠的两段

### memory-import.spec.ts（2 个，留 2；265 行）

| 测试                                                                                                    | 类  | 行    | 决定 | 守的链路 / 删除映射                                        |
| ------------------------------------------------------------------------------------------------------- | --- | ----- | ---- | ---------------------------------------------------------- |
| previews a file in full, writes nothing until confirmed, then reports the server's counts               | ①   | 82    | 留   | 记忆导入主流程：完整预览、确认前不写、报告服务器计数       |
| a reply lost after the server wrote the batch is not sure, is read back, and is never resent on its own | ④   | 63+63 | 留   | 服务器已写入但应答丢失时标为不确定、回读核对、绝不自动重发 |

修剪（T-0570，不删测试）：`faultProxy` 的 `reply`/`replaceResult`
两种计划已无调用者（约 25 行）

### mobile-handoff.spec.ts（2 个，留 2；125 行）

| 测试                                                                                                  | 类  | 行  | 决定                | 守的链路 / 删除映射                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | --- | --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| desktop handoff lets a fresh phone approve work without entering folders                              | ①   | 76  | 留（收并入）        | 桌面接力到新手机后直接审批（跨设备主流程）。T-0570 并入 mobile-remote「the overview shows waiting work…」的「手机上没有会话级允许」和线上 decision 断言 |
| a forged handoff never auto-connects, imports nothing, and cannot choose where a pasted token is sent | ③   | 31  | 留（T-0570 已合并） | 恶意交接一条测完：不自动连接、不导入路径；真实回环接收端核令牌实际去向（并入 handoff-origin）                                                           |

### mobile-remote.spec.ts（7 个，留 6；616 行 → A 后 548）

| 测试                                                                                                              | 类  | 行    | 决定  | 守的链路 / 删除映射                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | --- | ----- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the overview shows waiting work and allows it once                                                                | ①   | 63+5  | 删(A) | 与 mobile-handoff「desktop handoff lets a fresh phone approve work…」是同一条「手机批准桌面工作」链，那条还核回合完成。本条标题说「只允许一次」，实际没数帧。把「手机上没有会话级允许」和线上 decision 断言（约 8 行）并入 mobile-handoff 那条 |
| a phone can deny, and never widens permissions                                                                    | ③   | 57    | 留    | 手机端能拒绝，且绝不扩大权限                                                                                                                                                                                                                   |
| a phone follow-up completes on the same session and survives a reload                                             | ④   | 50    | 留    | 手机追问在同一会话完成并熬过刷新                                                                                                                                                                                                               |
| a phone starts a new session in a watched folder, keeps a refused first task as a draft, and every screen sees it | ②   | 100   | 留    | 手机在关注文件夹开新会话，被拒的首个任务留作草稿，各屏都看得到                                                                                                                                                                                 |
| an unreachable server reads as offline, and the overview recovers                                                 | ④   | 50    | 留    | 服务器不可达显示离线，恢复后总览自动恢复                                                                                                                                                                                                       |
| a sandbox escalation can only be denied from the phone                                                            | ⑤   | 55    | 留    | 沙箱提权在手机上只能拒绝（有意设计）                                                                                                                                                                                                           |
| a peer's question is answered from the phone's dock with the option picked                                        | ②   | 36+69 | 留    | 手机坞回答协作者的问题，发送所选项（手机×协作者）                                                                                                                                                                                              |

修剪（T-0570，不删测试）：「a phone can deny…」的拒绝半段（拒绝路径已由「a
sandbox escalation can only be denied…」覆盖，约 40 行），保留「不扩大权限」

### modal-a11y.spec.ts（1 个，留 0；38 行 → A 后 0）

| 测试                                                | 类  | 行    | 决定  | 守的链路 / 删除映射                                                                                                                                                                                |
| --------------------------------------------------- | --- | ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab and Shift+Tab cycle focus inside the modal only | ⑤   | 15+15 | 删(A) | 与 modal-stack「review above an approval owns Tab and Escape at 320px」走同一个 `ui/ModalSurface` 焦点陷阱，那条在 320px 叠层下核 Tab 循环、Shift+Tab 回绕和 Escape 归属。共同失败：焦点跑出模态框 |

### modal-stack.spec.ts（1 个，留 1；87 行）

| 测试                                                  | 类  | 行   | 决定 | 守的链路 / 删除映射                                            |
| ----------------------------------------------------- | --- | ---- | ---- | -------------------------------------------------------------- |
| review above an approval owns Tab and Escape at 320px | ②   | 81+1 | 留   | 评审叠在审批之上时 Tab/Esc 的模态栈归属（provider 确认变体删） |

### model-management.spec.ts（3 个，留 2；248 行 → A 后 214）

| 测试                                                                  | 类  | 行     | 决定         | 守的链路 / 删除映射                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | --- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manages a provider through the DSH-style Models settings flow         | ①   | 105+27 | 留（收并入） | Models 设置主流程。T-0570 并入「keeps a rejected provider draft…」的固定报错文案和草稿保留                                                                                                                                                                                      |
| keeps a rejected provider draft while redacting the failure           | ③/④ | 34     | 删(A)        | 「脱敏」断言不会红，因为 mock 从不回显密钥。真正的脱敏由 profile-mutation「a failed credential write…」守（服务器回显密钥，核 DOM 和存储），onboarding 的同一路径由 product「onboards an empty solo server…」守。固定报错文案和草稿保留并入 model-management 第一条（约 +8 行） |
| opening a session with no usable chat model goes to Settings › Models | ②   | 45     | 留           | 打开没有可用模型的会话时进入 Settings › Models（会话×设置路由）                                                                                                                                                                                                                 |

### multi-session-fence-soak.spec.ts（1 个，留 0；506 行 → A 后 0）

| 测试                                                                                                                                              | 类  | 行      | 决定          | 守的链路 / 删除映射                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| holds 12 Sessions + 3 native peers on one pooled socket, refuses a peer-owned interrupt with the fence notice, and keeps per-Session record order | ④   | 150+248 | 删(A)，整文件 | 拒绝（`peer/fence`、-32043）完全由 mock 产生。网页没有处理它的代码（在 apps/web/src 和 packages/client/src 里搜 `peer/fence`、`32043` 都没有结果），测试也不核任何 UI。标题里的「keeps per-Session record order」没有断言。它对网页的检查已分别在 capacity-and-peers（12+3 单 socket）、surface-recovery「a failed model-management chunk…」（Stop 只发一次中断）、peer-activity-and-restore / peer-reload（dock 行） |

### multi-session-recovery-soak.spec.ts（2 个，留 1；755 行 → A 后 523）

| 测试                                                                                                                                     | 类  | 行     | 决定  | 守的链路 / 删除映射                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parks a background approval on its owning Session across A/B/C switching, drains its queued followup, and survives an observer reconnect | ②/④ | 226+78 | 留    | 后台审批挂起归属 + 观察者重连存活                                                                                                                                                                                     |
| keeps exactly ONE live transport while an active A and its queued A2 recover across a transport disconnect                               | ④   | 167+65 | 删(A) | 与 simultaneous-sessions「recovers an unacknowledged A1 behind B…」是同一条链：断线后 hydrate 报 A1 中断，队列只排空一次，不重放 A1，选中不跳。本条独有的「任何时刻只有一个活连接」（`peak() <= 1`，约 8 行）移入那条 |

修剪（T-0570，不删测试）：删约 50 行只看 fixture 自身状态的断言（诊断快照 493–512、terminal-hold 自检 538–561）

### native-fleet.spec.ts（1 个，留 1；84 行）

| 测试                                                              | 类  | 行    | 决定 | 守的链路 / 删除映射                                           |
| ----------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------------------- |
| native Fleet uses prepare/open/start, gather, steer and interrupt | ①   | 62+11 | 留   | 原生 Fleet 主链：prepare/open/start、gather、steer、interrupt |

### native-workflows.spec.ts（5 个，留 5；623 行）

| 测试                                                                                                                    | 类  | 行    | 决定                | 守的链路 / 删除映射                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | --- | ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| native commands fail closed when the original fixture does not advertise them                                           | ③   | 48    | 留                  | 未广告的原生命令 fail-closed                                                                                                                                    |
| Enter steers a compatible running turn by default, while the Queue control defers it                                    | ①/② | 55    | 留                  | Enter 默认 steering 的输入×回合跨功能链，Queue 控件让行（原两条已合为一条）                                                                                     |
| a dropped native steer returns once to its owning FIFO while a different Session is selected                            | ④   | 106+7 | 留                  | 掉线 steer 一次性回归属主 FIFO（归属恢复）                                                                                                                      |
| goal pause, resume and stop preserve the current objective and budget, and newer notifications cancel stale transitions | ②   | 76    | 留                  | goal 生命周期×通知：新通知取消过期转换                                                                                                                          |
| native agent receipts settle terminal status and delayed artifact reads cannot cross Session ownership                  | ③   | 144   | 留（T-0570 已加固） | 原生 agent 回执了结终态，延迟的产物读取不能跨会话归属；嵌套未脱敏内容被脱敏。迟到的 status 读改在重新读取之前检查：不得装上关闭前的状态，去掉 revision 守卫会红 |

修剪（T-0570，不删测试）：「a dropped native steer…」的文案断言和 `/turn`
检查器（约 15 行）

### onboarding.spec.ts（3 个，留 3；119 行）

| 测试                                                                                                                                  | 类  | 行    | 决定 | 守的链路 / 删除映射                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ---- | ----------------------------------------------------------------------------- |
| validates the address without opening a socket and leaves focus on the correction                                                     | ①   | 28    | 留   | 连接门地址校验不开 socket                                                     |
| explains missing authentication while preserving password privacy and IME entry                                                       | ③   | 31    | 留   | 认证缺失提示不泄漏已输入密码（凭据边界）                                      |
| authenticates without opening a Session, starts a first workspace with the keyboard, and focuses the useful field when adding another | ①   | 40+12 | 留   | 认证先行不开会话 + 键盘完成首个工作区创建（product 的 hero 用例已并入，#395） |

### pairing-link.spec.ts（2 个，留 1；96 行 → A 后 76）

| 测试                                                           | 类  | 行   | 决定  | 守的链路 / 删除映射                                                                                                                                             |
| -------------------------------------------------------------- | --- | ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| an octos origin off this computer is refused without a request | ③   | 20   | 删(A) | 同一规则、同一可观察失败（向非本机地址发了请求），已由 apps/web 单测 `connection/pairing.test.ts`「refuses a non-loopback origin without making the request」守 |
| the paired token survives only this tab until Forget           | ③   | 38+2 | 留    | 配对令牌只存活本标签页直至 Forget（凭据范围）                                                                                                                   |

### peer-activity-and-restore.spec.ts（2 个，留 1；328 行 → A 后 267）

| 测试                                                                                                                                                         | 类  | 行     | 决定  | 守的链路 / 删除映射                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the peer dock follows each peer's own Session › rows go idle -> live -> blocked -> live -> done, approvals stay fail-closed, /peer clear prunes the done row | ①/② | 114+73 | 留    | 真实 peer 事件驱动行从空闲到完成、审批 fail-closed、/peer clear 清理（peer-dock 已并入，#374）                                                                                                                                              |
| per-session interrupt-prompt restore › a draft is restored only in the session that owned the interrupted turn                                               | ④   | 59+2   | 删(A) | 恢复发生前从未切换会话，没测到标题说的跨会话。跨会话规则由 apps/web 单测 `use-turn-controller.test.ts`「restores an interrupted prompt on its OWN session's terminal, never another session's」守，单会话恢复由 stop-returns-attachments 守 |

### peer-control.spec.ts（4 个，留 4；276 行）

| 测试                                                                                                                                                         | 类  | 行   | 决定 | 守的链路 / 删除映射                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---- | ---- | -------------------------------------------------------- |
| peer/control seat semantics (pane Advanced, synthetic fixture) › no seat panel when external_driver_v1 is unadvertised (no-feature)                          | ⑤   | 8    | 留   | P2d 严格 opt-in：无 feature 无座席（no-method 变体删）   |
| peer/control seat semantics (pane Advanced, synthetic fixture) › each command, from the keyboard or a click, emits exactly ONE frame and an accepted receipt | ①   | 36+9 | 留   | 座席各命令（键盘或点击）各发恰好一帧并收到 accepted 回执 |
| peer/control seat semantics (pane Advanced, synthetic fixture) › a refused RECEIPT renders the typed peer_control_refused refusal                            | ④   | 15   | 留   | 类型化拒绝渲染（accepted/replay 参数变体删）             |
| peer/control seat semantics (pane Advanced, synthetic fixture) › a driver_fence_stale typed error drops the seat, keeps the §6 label                         | ④   | 25+1 | 留   | 围栏过期丢座席留有限文案（keyboard-reachable 变体删）    |

修剪（T-0570，不删测试）：断言 mock `replyTo` 的部分

### peer-controller.spec.ts（2 个，留 2；369 行）

| 测试                                                                                                                                                                    | 类  | 行   | 决定 | 守的链路 / 删除映射                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ---- | ---------------------------------------------------------------------------------- |
| Fleet view (migrated console semantics) › Start opens only with model and brief, dispatches once per Start, and the row's Steer, Approve and Stop each send one frame   | ①/④ | 99+9 | 留   | Fleet 派发主流程：每次 Start 恰好一帧，行上 Steer/Approve/Stop 各一帧（#376 合并） |
| Fleet view (migrated console semantics) › a refused dispatch shows its bounded label, never server copy, and Start tries again with a NEW request until one is accepted | ③/④ | 51+5 | 留   | 拒绝只显示有限文案、不搬服务器原文，重试用新请求（过期租约用例已并入，#376）       |

### peer-readonly-composer.spec.ts（1 个，留 1；216 行）

| 测试                                                          | 类  | 行     | 决定 | 守的链路 / 删除映射      |
| ------------------------------------------------------------- | --- | ------ | ---- | ------------------------ |
| focused peer shows the read-only composer and Esc never leaks | ③   | 127+36 | 留   | 聚焦 peer 的只读输入边界 |

修剪（T-0570，不删测试）：步骤 4b（主会话 Esc 中断，与 keyboard-parity「Esc
closes the palette…」相同）和同义反复的 `peerId`
断言（约 20 行）；只留「peer 视图上 Esc 不发中断」

### peer-reload.spec.ts（1 个，留 1；152 行）

| 测试                                                                        | 类  | 行     | 决定 | 守的链路 / 删除映射                                  |
| --------------------------------------------------------------------------- | --- | ------ | ---- | ---------------------------------------------------- |
| a finished peer keeps its place, read-only view and way back after a reload | ④   | 105+23 | 留   | 刷新后已完成的协作者保留位置、只读视图和回主会话入口 |

### plan-card.spec.ts（1 个，留 1；108 行）

| 测试                                                                    | 类  | 行    | 决定 | 守的链路 / 删除映射                                 |
| ----------------------------------------------------------------------- | --- | ----- | ---- | --------------------------------------------------- |
| shows the plan, replaces it wholesale, and clears it when the turn ends | ①   | 37+45 | 留   | 计划卡呈现/整体替换/回合结束清除（键盘/门控变体删） |

### product.spec.ts（19 个，留 15；1222 行 → A 后 1186，A+B 后 1108）

| 测试                                                                                       | 类  | 行     | 决定         | 守的链路 / 删除映射                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | --- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| keeps authentication when a remembered Session can no longer open                          | ④   | 42     | 留           | 记忆会话打不开时认证不回退                                                                                                                                                                       |
| keeps a server-accepted turn and sibling records on the same pooled socket                 | ④   | 78     | 留           | 已接受回合与兄弟记录共用单池 socket                                                                                                                                                              |
| keeps B selected when A's unacknowledged start is rejected                                 | ④   | 70     | 留           | A 未确认启动被拒时 B 保持选中（held-start 竞态族代表）                                                                                                                                           |
| reports a start acknowledgement timeout as unknown, then settles on release                | ④   | 33     | 留           | 启动确认超时先 unknown 后落定                                                                                                                                                                    |
| recovers A's held start with ${scenario.name} while B stays selected and unopened          | ④   | 88     | 留           | A 的 start 被扣住时 B 保持选中且不被打开。表驱动 4 种恢复：普通回合、hydrate 出的审批、恢复中缓冲的审批请求、恢复中缓冲的审批结果，各跑一次。四行守的是不同的迟到帧，整张表保留                  |
| does not project ambiguous legacy Session rows into a Workspace                            | ④   | 18     | 留           | 歧义旧行不投影进工作区（数据完整性）                                                                                                                                                             |
| lists a workspace's server-attested history in a fresh tab and opens a row it never opened | ①   | 39     | 留           | 新标签页列出服务器背书历史并打开未开过行                                                                                                                                                         |
| moves drafts only after a profile-choice Session transition commits                        | ④   | 34     | 留（收并入） | profile 选择过渡提交后才移动草稿。T-0570 并入 auth-identity「binds a cross-profile launch…」的 `session/open` `profile_id` 断言                                                                  |
| restores the origin, tab credential, session, and workspace after refresh                  | ④   | 26     | 留           | 刷新恢复 origin/凭据/会话/工作区四元组                                                                                                                                                           |
| offers whole permission presets and confirms full access                                   | ③   | 58     | 留           | 权限整档预设 + 完全访问确认                                                                                                                                                                      |
| separates the Session runtime from the Profile default model                               | ②   | 16+113 | 留           | 会话运行时与 profile 默认模型分离（跨功能）                                                                                                                                                      |
| owns plan and background work under the active session Trajectory                          | ②   | 39     | 删(B，已批)  | 只核 Trajectory 的标题和视图切换，标题说的「归属」没测。计划卡由 plan-card 守，后台运行由 cron「shows how each run really went…」守                                                              |
| does not expose implementation and diagnostic concepts as product IA                       | ⑤   | 18     | 删(B，已批)  | 只断言若干内部词不出现（负向文案），没有设计说明注释，属结构/文案绑定                                                                                                                            |
| sends prompts without presenting billed input usage as context occupancy                   | ⑤   | 21     | 删(B，已批)  | 只断言一个 title 文案不出现；正向发送链到处都有                                                                                                                                                  |
| recovers the durable session after disconnect and lossy replay                             | ④   | 68     | 留           | 断线 + 有损重放后的持久会话恢复                                                                                                                                                                  |
| resolves approval and structured-question takeovers                                        | ②   | 36     | 删(A)        | 问题半被 interaction-ownership「keeps three concurrent parked questions…」包含；批准半由 final-input「approval shortcuts…」和 modal-stack 守。共同失败：接管卡片不出现，或回应不落地。本条不核帧 |
| onboards an empty solo server from workspace creation                                      | ①   | 60     | 留           | 空 solo 服务器从建工作区起步（自动激活变体删）                                                                                                                                                   |
| preserves Octoscode keyless-provider onboarding semantics                                  | ⑤   | 19     | 留           | 无 key provider 入门语义的设计例外                                                                                                                                                               |
| keeps the DSH-aligned dark product shell WCAG A/AA clean                                   | ⑤   | 107    | 留           | axe 门禁：暗色产物壳 WCAG A/AA（keyboard/semantics 与 skip-link 变体删）                                                                                                                         |

修剪（T-0570，不删测试）：「keeps the DSH-aligned dark product
shell…」里不断言的截图和诊断（约 55 行），保留 axe 检查

### profile-mutation.spec.ts（2 个，留 2；279 行）

| 测试                                                                                                                           | 类  | 行  | 决定 | 守的链路 / 删除映射                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ---- | ---------------------------------------------------------------- |
| skill removal holds the profile lock through deferred replies and deduplicates confirmation; reviewing a source writes nothing | ④   | 60  | 留   | profile 锁贯穿延迟应答 + 确认去重，评审来源不写入（并发/完整性） |
| a failed credential write clears its input, consumes confirmation and requires a fresh review                                  | ③   | 84  | 留   | 凭据写失败清输入、需重新评审（安全）                             |

修剪（T-0570，不删测试）：`succeed()` 里 install 成功分支已无调用者（约 9 行）

### resume-and-reasoning.spec.ts（4 个，留 4；372 行）

| 测试                                                                                                   | 类  | 行   | 决定                | 守的链路 / 删除映射                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | --- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| resume lists unverified candidates, refuses bare IDs, and requires confirmation plus canonical history | ③   | 58   | 留                  | 恢复未验证候选需确认 + canonical 历史（安全）                                                                                                                            |
| canceling a held historical open cannot install a late transcript or steal a new selection             | ④   | 74   | 留（T-0570 已调整） | 取消被扣住的历史打开后，迟到的 transcript 不安装、不抢新的选中。选中和草稿检查移到迟到历史送到之后、测试自己点击之前；App 还有一层守卫，单层变异抢不走选中，新旧两版都绿 |
| resuming an already retained busy historical Session never reopens or resets its turn                  | ②   | 81   | 留                  | 恢复已保留的忙碌历史会话不重开不复位                                                                                                                                     |
| reasoning visibility is retained per Session and does not change captured model effort                 | ②   | 83+5 | 留                  | reasoning 可见性按会话保留、不改模型 effort 记录                                                                                                                         |

### runtime-recovery.spec.ts（1 个，留 1；178 行）

| 测试                                                                                  | 类  | 行    | 决定 | 守的链路 / 删除映射              |
| ------------------------------------------------------------------------------------- | --- | ----- | ---- | -------------------------------- |
| continues past an unknown turn without replaying it or losing the queue and new draft | ④   | 173+1 | 留   | 未知回合不重演、队列与新草稿不丢 |

### scanned-pdf.spec.ts（2 个，留 2；149 行）

| 测试                                                                                  | 类  | 行   | 决定 | 守的链路 / 删除映射                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | --- | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renders black-and-white and JPEG 2000 scans and reads them in the browser             | ①/③ | 46   | 留   | 黑白（CCITT）和 JPEG 2000 扫描件不再空白（T-0567 的 G1）；本地 OCR 英文、中英文给出正确文字，照片页报「没有可靠文字」而不说无文本；只访问本站和 fixture，不写 Cache Storage/IndexedDB/web storage（PDF/OCR 内容不出浏览器） |
| says when the server can't run recognition, and cancelling or closing ends the worker | ④/③ | 51+2 | 留   | OCR 目录保持页面 CSP 时如实报「此服务器不支持」并可重试；取消、收起「Page text」都结束识别线程，不冒出迟到结果（预览×取消；T-0568）                                                                                         |

### server-shutdown.spec.ts（1 个，留 1；103 行）

| 测试                                                                                 | 类  | 行   | 决定 | 守的链路 / 删除映射               |
| ------------------------------------------------------------------------------------ | --- | ---- | ---- | --------------------------------- |
| server shutdown is capability gated, explicit, and truthful on an unconfirmed result | ⑤   | 98+1 | 留   | 关机能力门控 + 未确认结果如实陈述 |

修剪（T-0570，不删测试）：320px 下 `toBeInViewport({ratio:1})` 的布局断言

### session-links.spec.ts（2 个，留 2；185 行）

| 测试                                                                                | 类  | 行    | 决定 | 守的链路 / 删除映射                                |
| ----------------------------------------------------------------------------------- | --- | ----- | ---- | -------------------------------------------------- |
| opens a bookmarked conversation in a fresh browser only after an explicit choice    | ③   | 65+21 | 留   | 书签会话须显式选择才打开（安全）                   |
| refuses a saved-link candidate with a different workspace before requesting history | ③   | 24+3  | 留   | 工作区不匹配的保存链接在请求历史前拒绝（目录隔离） |

修剪（T-0570，不删测试）：删没人用的 `reject-once`
模式（约 17 行）和只存文件、不断言的 `panel.screenshot`

### session-panel.spec.ts（3 个，留 3；269 行）

| 测试                                                                 | 类  | 行    | 决定         | 守的链路 / 删除映射                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | --- | ----- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files ignores a late listing from the previous workspace root        | ④   | 41+16 | 删（T-0586） | 从 UI 走不到：Files 的根跟会话绑定（打开时 `workspace_root` 必须等于请求的目录，否则拒绝）；换会话时面板按会话 id 重挂；任何根变化都会在同一次渲染里换成「Loading folders…」，卸掉旧的 Files；这条测试自己的流程里，Add workspace 对话框一打开面板就不在了。去掉面板 key、tree probe 的根匹配、generation 守卫三者一起仍绿，没有可观察的单层回归，不补替代测试 |
| one file stays selected across diff, output, reload and read failure | ②   | 141   | 留           | 同一个文件在 diff、输出、刷新和读失败之间保持选中                                                                                                                                                                                                                                                                                                              |
| Files browses the real workspace tree and previews any file in it    | ①   | 52    | 留           | 侧栏浏览真实工作区树并预览任意文件                                                                                                                                                                                                                                                                                                                             |

### settings-memory.spec.ts（3 个，留 3；217 行）

| 测试                                                                                | 类  | 行  | 决定 | 守的链路 / 删除映射                                                                  |
| ----------------------------------------------------------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------------ |
| ingest → search → detail survives a page refresh, and failures stay honest          | ①   | 82  | 留   | 记忆写入、搜索、详情链熬过刷新，失败如实显示                                         |
| fails closed when authenticated memory ownership differs from the Session profile   | ③   | 21  | 留   | 记忆归属与会话 profile 不一致时失败关闭（身份隔离）                                  |
| long-term entries edit and delete on the server, and a failed change keeps the text | ①/③ | 103 | 留   | 记忆条目按版本编辑、确认后删除，冲突/未确认/已不在都如实且留住文字，刷新以服务器为准 |

### settings-mobile.spec.ts（1 个，留 1；114 行）

| 测试                                | 类  | 行    | 决定 | 守的链路 / 删除映射                      |
| ----------------------------------- | --- | ----- | ---- | ---------------------------------------- |
| Settings remain operable at 320×480 | ①   | 87+20 | 留   | 手机视口 Settings 可操作（手机独有边界） |

### simultaneous-sessions.spec.ts（3 个，留 2；506 行 → A 后 384）

| 测试                                                                                             | 类  | 行    | 决定         | 守的链路 / 删除映射                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | --- | ----- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| isolates independent turns across rapid Session switches                                         | ④   | 121+1 | 删(A)        | 被 capacity-and-peers 包含：同一组失败（会话间串文字、回到会话时重复 start、切换时发中断、后台完成标记），capacity 在 15 条记录上逐个核 |
| recovers an unacknowledged A1 behind B and drains A2 then A3 without replaying A1                | ④   | 130   | 留（收并入） | 未确认 A1 恢复 + FIFO 顺序排空不重演（drain 变体删）。T-0570 并入 recovery-soak「keeps exactly ONE live transport…」的 `peak() <= 1`    |
| preserves native persisted segment finality across late deltas and the next background FIFO turn | ④   | 174   | 留           | 迟到 delta 与后台 FIFO 下原生段 finality（数据完整性）                                                                                  |

修剪（T-0570，不删测试）：删「preserves native persisted segment
finality…」里 fixture 自己的信封序列块和
`testInfo.attach`（约 30 行），并把它的 docblock 改成讲 finality；「recovers an
unacknowledged A1…」加入 recovery-soak 的 `peak() <= 1`（+8）

### skill-install-review.spec.ts（6 个，留 5；450 行 → A 后 424）

| 测试                                                              | 类  | 行  | 决定         | 守的链路 / 删除映射                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --- | --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reviews what the server reports, read only                        | ①   | 41  | 留（收并入） | 技能安装评审主流程（只读）。T-0570 并入「a source that moves after its review…」的旧审阅失效一步                                                                                                                                                     |
| a source that moves after its review drops it and stays read-only | ③   | 26  | 并入(A)      | 并入「reviews what the server reports, read only」：两条都在旧 Core（不提供安装）上，共同失败是出现安装控件或发出安装请求。要并入的独有一步：改分支后旧审阅关闭，重新审阅显示新分支，按 Enter 不发安装（约 +10 行）。#437 只改了标题和写法，映射不变 |
| keeps sources and tokens out of browser storage                   | ③   | 16  | 留           | 来源和令牌不进浏览器存储                                                                                                                                                                                                                             |
| installs exactly the reviewed object and re-reads the server      | ①   | 47  | 留           | 审阅→确认→安装主链：请求带审阅锁定的 commit 和 digest，回执逐项匹配，状态从服务器重读（T-0555，#437）                                                                                                                                                |
| a changed registry refuses the install and nothing else happens   | ③   | 30  | 留           | 审阅后注册表变了，Core 按类型拒绝，不安装，审阅关闭，状态如实（防供应链换包）                                                                                                                                                                        |
| an unconfirmed install is re-read from the server, never claimed  | ④   | 29  | 留           | 安装结果不明（应答超时）时不重试、不冒称已安装，从服务器重读（写入结果不明）                                                                                                                                                                         |

修剪（T-0570，不删测试）：`start` 的中文显示分支和 `searchFails`
分支已无调用者（约 25 行）

### startup-close-error.spec.ts（2 个，留 1；122 行 → A 后 100）

| 测试                                                                           | 类  | 行  | 决定         | 守的链路 / 删除映射                                                                                                                                                   |
| ------------------------------------------------------------------------------ | --- | --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a 1008 launch explains the Profile and keeps the login across the reconnect    | ④   | 30  | 留（收并入） | 1008 关闭说明 Profile 原因，重连后保留登录。T-0570 并入「a new Session that fails from an open one…」的会话内失败一步，并补上那条漏掉的「会话保留」断言               |
| a new Session that fails from an open one keeps both the error and the Session | ④   | 22  | 并入(A)      | 并入「a 1008 launch explains the Profile…」：同一 1008+重连机制、同一失败（T-0177），只是换了入口。并入「新会话失败时报错和会话都保留」一步（约 +8 行），少等一次 6 s |

修剪（T-0570，不删测试）：删没人调用的
`refuseReconnect`/`rejectOpen`（约 19 行）；并入后少一次 6 s 固定等待

### stop-returns-attachments.spec.ts（1 个，留 1；75 行）

| 测试                                                                            | 类  | 行   | 决定 | 守的链路 / 删除映射                                   |
| ------------------------------------------------------------------------------- | --- | ---- | ---- | ----------------------------------------------------- |
| stopping a turn returns its prompt and files, and sending again needs no upload | ②   | 66+1 | 留   | 停止回合退回提示和文件，再发无需重新上传（停止×附件） |

### surface-recovery.spec.ts（2 个，留 2；158 行）

| 测试                                                                       | 类  | 行   | 决定                | 守的链路 / 删除映射                                                                                        |
| -------------------------------------------------------------------------- | --- | ---- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| a failed model-management chunk preserves the owner, queue, draft and Stop | ④   | 85+7 | 留                  | 失败 chunk 不丢属主/队列/草稿/停止（import 取消/Escape/review 变体删）                                     |
| a late clipboard command result does not enter a different conversation    | ④   | 41   | 留（T-0570 已加固） | 迟到的剪贴板命令结果不进入别的对话。补正向对照：回到发起的对话应看到「Copied」；复制完成不再报告的变异会红 |

修剪（T-0570，不删测试）：「a failed model-management chunk…」的 4 行文案断言

### tab-lock.spec.ts（1 个，留 1；80 行）

| 测试                                                                    | 类  | 行   | 决定                | 守的链路 / 删除映射                                                                                                                                 |
| ----------------------------------------------------------------------- | --- | ---- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| a second tab sees the lock, takes over, and the first tab sees the loss | ④   | 69+2 | 留（T-0570 已加固） | 唯一的多标签写锁测试：第二个标签页看到锁、接管，第一个标签页看到失去控制。补在被锁标签页回车发送：不发 `turn/start`、文字保留；去掉发送门的变异会红 |

### takeover-layout.spec.ts（1 个，留 0；71 行 → A 后 71，A+B 后 0）

| 测试                                                   | 类  | 行    | 决定                | 守的链路 / 删除映射                                                                                                                                         |
| ------------------------------------------------------ | --- | ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| approval keeps the document and header stable at 390px | ①   | 15+49 | 删(B，已批)，整文件 | 只核滚动位置、页头盒子和按钮重叠（布局几何）。手机上长批准可读、可操作由 final-input「long approval remains readable…」守，手机批准整链由 mobile-handoff 守 |

### template-interactions.spec.ts（2 个，留 2；75 行）

| 测试                                                                        | 类  | 行  | 决定 | 守的链路 / 删除映射                                                                         |
| --------------------------------------------------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------------------- |
| a write template blocks read-only sending and offers one-click write access | ②   | 38  | 留   | 写入型模板挡住只读发送并提供一键可写（模板×权限）                                           |
| a read-only template waits for the permission receipt before sending        | ②/③ | 24  | 留   | 只读模板等权限收窄回执到了才发；回执前再按发送也不发（模板×权限，fail-closed；T-0530 补回） |

### template-launch.spec.ts（1 个，留 1；88 行）

| 测试                                                                                      | 类  | 行    | 决定 | 守的链路 / 删除映射                              |
| ----------------------------------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------ |
| a rejected template launch retries its session identity and preserves the draft on reload | ④   | 71+12 | 留   | 模板启动被拒后用同一会话身份重试，刷新后草稿仍在 |

修剪（T-0570，不删测试）：第二次刷新段（草稿刷新不发送由 draft-recovery 守）

### theme.spec.ts（2 个，留 1；133 行 → A 后 133，A+B 后 83）

| 测试                                                                             | 类  | 行    | 决定        | 守的链路 / 删除映射                                                                                                                                       |
| -------------------------------------------------------------------------------- | --- | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| theme choices preserve one palette across manual and system modes                | ⑤   | 33+17 | 删(B，已批) | 比较 CSS 自定义属性值（外观，AGENTS.md 不测）。偏好只在显式保存时落盘由 local-preferences「only explicit save…」守，存储被禁时主题仍可用由 theme 第二条守 |
| blocked localStorage property keeps connection, session launch, and theme usable | ④   | 57    | 留          | localStorage 被禁用时连接、开会话和主题仍可用                                                                                                             |

### timeline-interactions.spec.ts（1 个，留 1；154 行）

| 测试                                                                               | 类  | 行    | 决定 | 守的链路 / 删除映射                                    |
| ---------------------------------------------------------------------------------- | --- | ----- | ---- | ------------------------------------------------------ |
| keeps activity and reader-controlled disclosures correct across ten streamed turns | ④   | 148+2 | 留   | 十个流式回合上活动披露与读者控制披露正确（长流完整性） |

### turn-undo.spec.ts（2 个，留 2；278 行）

| 测试                                                                                      | 类  | 行     | 决定 | 守的链路 / 删除映射                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| undo puts the turn's files back, keeps the conversation and draft, redo survives a reload | ①/② | 135+12 | 留   | 撤销恢复文件、保留对话和草稿，重做熬过刷新；Core 拒绝的重做以原话显示且不重试；后续回合跑过后旧轮不再提供重做（撤销×后续回合；T-0530 并入） |
| another tab's undo leaves this tab's stale entry unsent and unsure                        | ④   | 63     | 留   | 另一标签页撤销后，本页过期的条目不发送、标为不确定                                                                                          |

修剪（T-0570，不删测试）：无作用的 `afterEach`

### two-modes.spec.ts（2 个，留 2；177 行，T-0597 新增）

| 测试                                                                                         | 类  | 行  | 决定 | 守的链路 / 删除映射                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | --- | --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat and Code keep their own lists and selections, across notifications, reloads and a phone | ①/② | 118 | 留   | 双模式 T-C 主链：切换只导航、不发 `*/set`；Chat/Code 列表互不混入（含 continue 入口）；每个模式回到自己的选中；后台 chat 完成的通知点回 Chat；刷新和手机打开同一链接都以服务端 `work_mode` 为准；手机抽屉切换后保持打开。变异（各自单独打）全红：不回到记住的选中、Code 不滤 chat、模式不取自服务端、通知不接、抽屉切换即关、chat 行未标记、continue 不分模式 |
| Chat stays off, and says why, on a server without chat folders                               | ③   | 23  | 留   | 能力门控：flag 关时侧栏不变；flag 开但服务端没协商到两项能力时 Chat 禁用并给出原因，键盘也切不过去。变异（去掉原因、无视 flag）全红                                                                                                                                                                                                                           |

T-0597 抵平（行为不变，只把重复的 setup 提成共享 helper，不计入行数口径）：`wire.ts`（`sendResult`
/ `sendError` /
`sendEnvelope`，替换 15 个 spec 里手写的 24 处 JSON-RPC 帧）、`attention-probe.ts`（attention 与 two-modes 共用的通知探针）、`fixture-session.ts`
的 `connect` / `openLink`（9 个 spec 的「填 origin、令牌、Connect」和「再点 Open
conversation」）、onboarding 改用
`observeSent`。上面各 spec 的行数表未随之重算。

### unfinished-flows.spec.ts（1 个，留 1；170 行）

| 测试                                                                                                                  | 类  | 行  | 决定 | 守的链路 / 删除映射                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | --- | --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a new session gets the saved permission default once, under its own id, and a refused one is reported on that session | ②/③ | 166 | 留   | 新会话按自己的 id 收到一次已存的权限默认值；被拒时在该会话失败关闭：不发 turn/start、草稿保留、别的会话不受影响，重试成功后只发一次；id 未绑定到所在 profile 的会话不发 set、保持阻止（设置×新会话×发送） |

### usage-ledger.spec.ts（1 个，留 1；216 行）

| 测试                                                                                      | 类  | 行     | 决定 | 守的链路 / 删除映射                                |
| ----------------------------------------------------------------------------------------- | --- | ------ | ---- | -------------------------------------------------- |
| shows the server's totals by model, date and session, and switches without mixing results | ①   | 100+90 | 留   | 用量账本按模型、日期、会话显示服务器总数，切换不串 |

### workspace-browse.spec.ts（2 个，留 2；109 行）

| 测试                                                                             | 类  | 行    | 决定 | 守的链路 / 删除映射                      |
| -------------------------------------------------------------------------------- | --- | ----- | ---- | ---------------------------------------- |
| browses the server's folders, drills in and out, and reports what the server hid | ①   | 46+12 | 留   | 服务器目录浏览进出 + 隐藏项如实报告      |
| shows no Browse affordance at all when the server does not advertise the feature | ⑤   | 17+2  | 留   | 未广告能力不出现 Browse 入口（门控设计） |

### workspace-ux.spec.ts（4 个，留 3；253 行 → A 后 197）

| 测试                                                                               | 类  | 行  | 决定  | 守的链路 / 删除映射                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IME confirmation and multiline editing never send; queued messages can be removed  | ③/① | 44  | 留    | IME 确认/多行编辑不误发 + 排队消息可撤                                                                                                                                               |
| protects a running turn from closing the tab and removes the warning on completion | ④   | 27  | 留    | 活动回合防误关标签页、完成后解除警告（数据丢失防护）                                                                                                                                 |
| keeps the mobile composer on screen and makes navigation an accessible drawer      | ①   | 50  | 留    | 手机输入框常驻 + 导航为可达抽屉（手机独有边界）                                                                                                                                      |
| follows arriving content but leaves a reader in history until they jump to latest  | ②   | 56  | 删(A) | 与 final-reading「360-message history…」是同一可观察失败：流式输出把翻到历史里的读者拽走，或读者在底部时不跟随。final-reading 断言更严：连续 10 帧不动，再按 Back to latest 回到底部 |

## 共享 setup 和 fixture 设计

`families.mjs`
在 72 个 spec 里量出 1,917 行本地副本，分属下面几族。T-0570 先把这些收进共享模块（单独一个提交，不改任何断言），再做删除。共享模块不是 spec，不计入
`test-lines.py`。

| 族                          | 定义数 | 涉及 spec | 行数 |
| --------------------------- | ------ | --------- | ---- |
| 连接并开会话                | 31     | 30        | 366  |
| 帧观察器                    | 35     | 23        | 803  |
| 扣住 terminal 或 turn/start | 14     | 6         | 165  |
| 侧栏和会话行                | 39     | 16        | 281  |
| 输入框和发送                | 23     | 18        | 73   |
| 运行时错误收集              | 4      | 2         | 60   |
| 打开设置页                  | 4      | 4         | 65   |
| peer 帧解码                 | 15     | 6         | 47   |
| 常量                        | —      | 38        | 57   |

模块和接口：

- **`fixture-session.ts`（已有，扩充）**：
  - `connectToChooser(page, { token? })`、`newSessionInWorkspace(page, workspace)`，替代 30 个 spec 里的连接副本；
  - `productNavigation(page)`、`sessionRow(nav, id)`、`selectedSessionId(nav)`、`selectSession(nav, id)`；
  - `openSettingsSection(page, name)`、`openFromLink(page, url, { token? })`（tab-lock、connection-storage、session-links 共用）；
  - `sendPrompt(page, text)`；
  - `browserStorage(page)` 和 `secretVisible(page, secret)`，供脱敏类断言共用。
- **`turn-observers.ts`（已有，扩充）**：
  - `observeFrames(page)` 返回
    `{ sent, received, calls(method), sockets: { live(), created(), peak() } }`，替代
    `observeProtocol`、`observeLiveTransports`、`observeScopeProbe`、resume 的
    `observe`、local-preferences 的 `observe` 和 connector-oauth 的
    `sentFrames`；
  - `observeTerminals(page)`（带 outcome）、`observeHydrates(page)`、`observeInteractions(page)`（请求和回应）、`trackRuntimeErrors(page)`。
- **新增
  `fixture-controls.ts`**：`holdTerminals(request, n)`、`heldTerminals(request)`、`releaseHeldTerminal(request, sessionId)`、`holdTurnStart`、`fixtureDiagnostics(request)`、`resetHolds(request)`、`disconnect(request)`。
- **新增 `relay.ts`**：
  - `relayProtocol(page, handlers)`：一个可改写帧的 WS 代理，替代各 spec 自写的
    `routeWebSocket` 包装；
  - `holdReply(relay, method)`：扣住某个应答；`release()`
    在应答帧**确实到达页面后**才 resolve。迟到类测试靠它拿到同步点；
  - `fakeTurns(relay)`、`advertiseMethods(relay, methods)`。
- **新增
  `peers.ts`**：peer 帧的 wire 解码、dock 行 helper、`asRecord`/`asString`/`asNumber`。

规则：只搬家，不在搬的时候放宽断言；只有一个 spec 用的 helper 留在原地；`fixture-session.ts`
已有的
`startSession`、`connectAndStartWorkspace`、`openSessionId`、`previewDelivery`
不改签名。

## 留下但要加固的测试

这些测试守的链路要留，但现在的写法可能空过，或者标题说的比断言多。T-0570 先做变异核实：故意弄坏对应的产品代码，看它红不红。红了就只改标题；不红就补断言。

- **迟到应答没有同步点**：cron「ignores a late create
  response…」、diff-review「Changes works before a turn…」、session-panel「Files
  ignores a late listing…」。释放后没等迟到帧到达就断言「不存在」。改用
  `holdReply`。
- **没有正向对照**：surface-recovery「a late clipboard command
  result…」，补「Copied 出现在自己的对话里」。
- **检查被测试自己的动作掩盖**：resume-and-reasoning「canceling a held
  historical open…」的抢选中检查在测试自己的点击之后；native-workflows「native
  agent receipts settle…」的 status-read 迟到检查被重新读取掩盖。
- **少一步**：tab-lock 从没在被锁的标签页尝试发送。
- **断言太弱**：conversation-search 的计数可能空过，改成核匹配到的具体文字。
- **标题超出断言**：connector-oauth「a restart-pending
  sign-in…」、connector-management「a delayed refresh blocks
  mutations…」、connection-storage「a 51st unsent draft evicts the
  oldest…」（只断言了逐出一条）。

## T-0570 执行备注

- **依据**：本清单（lead-web
  11-11 有条件批准）。删除 PR 只核对三件事：删掉的都标了删或并入，留下的都在，下面的并入项都已落地并有变异证明。
- **变异证明**：故意弄坏对应的产品代码（或去掉 fixture 的对应行为），只跑那条保留测试，确认它红；恢复后确认它绿。PR 说明逐项写弄坏了什么、红在哪一行断言。
- **顺序**，每步一个提交：
  1. **补两个大小上限**（批复要求，先于任何删除）：
     - artifact-preview「keeps a structured write
       artifact…」补一步：交付一个超限文件，断言不预览、仍可下载；
     - `apps/web/src/features/media/attachment-drafts.test.ts` 补一条：超过
       `MAX_UPLOAD_BYTES`（图片是 `MAX_IMAGE_BYTES`）的文件判为
       `too-large`，不进入草稿；
     - 两条都做变异证明。
  2. **共享 helper 搬家**：不改断言，跑全量 e2e。
  3. **并入**：把被删测试独有的断言和负例加进保留测试，每项做变异证明。完成前不删对应的测试。

     | 被删的测试                                                        | 并入到                                                        | 必须带过去的断言或负例                                                                           |
     | ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
     | approval-clarity「permission retry requires an applied…」         | 同文件「refuses a response that broadens…」，合成表驱动       | `applied:false` 时报错、不重做回合；扩大网络访问的应答同样拒绝                                   |
     | auth-identity「binds a cross-profile launch…」                    | product「moves drafts only after a profile-choice…」          | `session/open` 带解析出的 `profile_id`，`session_id` 前缀对                                      |
     | interaction-ownership「restores and resolves a parked question…」 | 同文件「keeps three concurrent parked questions…」            | respond 负载 `answers: [{selected_labels: ["Full"]}]`                                            |
     | multi-session-recovery-soak「keeps exactly ONE live transport…」  | simultaneous-sessions「recovers an unacknowledged A1…」       | 恢复全程 `peak() <= 1`                                                                           |
     | handoff-origin「a forged cross-origin handoff…」                  | mobile-handoff「a handoff never auto-connects…」，合成一条    | 伪造来源的交接不能决定粘贴的令牌发往哪里：由真实接收端核令牌实际到达的目的地；不自动连接、不导入 |
     | cron「uses the current session scope…」                           | cron「creates At, Every and Cron jobs…」                      | list、toggle、create、delete 每帧都带当前会话的 `session_id`                                     |
     | expert-teams「a reconnect keeps a working member…」               | 同文件「a failed member is named…」                           | 断线重连后工作中的成员仍在工作，网页不自己发 stop                                                |
     | mobile-remote「the overview shows waiting work…」                 | mobile-handoff「desktop handoff lets a fresh phone approve…」 | 手机上没有会话级「允许」，线上 decision 只是一次性允许                                           |
     | model-management「keeps a rejected provider draft…」              | 同文件「manages a provider…」                                 | 被拒时显示固定报错文案，草稿保留                                                                 |
     | skill-install-review「a source that moves after its review…」     | 同文件「reviews what the server reports…」                    | 改分支后旧审阅关闭，重新审阅显示新分支，按 Enter 不发安装                                        |
     | startup-close-error「a new Session that fails from an open one…」 | 同文件「a 1008 launch explains the Profile…」                 | 会话内新建失败时，报错和原会话都保留（原测试漏了「会话保留」的断言，并入时补上）                 |

     其余 11 条 A 档删除不需要搬断言，映射到的测试已经断言了共同失败。删之前各做一次变异证明，确认映射测试会因那个失败变红。映射到 e2e 的：driver-discovery「holds
     ONLY the first walk…」「surfaces a typed
     refusal…」、modal-a11y、product「resolves approval and structured-question
     takeovers」、simultaneous-sessions「isolates independent
     turns…」、workspace-ux「follows arriving
     content…」。映射到单测的：driver-discovery「rejects a
     MALFORMED…」、pairing-link「an octos origin off this
     computer…」、peer-activity-and-restore「a draft is restored
     only…」，变异后跑对应单测。只测 mock 的：auth-identity「accepts a
     profile-routable…」、multi-session-fence-soak，网页没有对应代码可弄坏，PR 里写明这一点即可。

  4. **删除**：A 档 22 条，B 档 5 条（product 三条、theme「theme choices
     preserve one palette…」、takeover-layout）。final-reading「code copy
     reports
     rejected…」保留；如果和别的测试合并，剪贴板被拒、剪贴板缺失两种负例都要在。
  5. **修剪**：按各 spec 下的「修剪」说明。
  6. **加固**：见「留下但要加固的测试」，先做变异核实。
- **行数**：PR 说明贴 `test-lines.py`
  的前后数字，回填本文件「结论和预测」的实测值。整体净减，不需要
  `test-growth-approved`。
- **CI**：必过检查名和分片配置不变。整个文件删掉的有
  `multi-session-fence-soak.spec.ts`、`modal-a11y.spec.ts`、`handoff-origin.spec.ts`、`takeover-layout.spec.ts`。分片按文件自动分配，不用改工作流。
- **不做**：不压行，不为凑数删本清单标「留」的测试，不改产品代码。

## T-0570 执行结果

基于 main `b12043df`，按上面的执行顺序做完。

**行数**（`test-lines.py` 口径，用同一套规则量工作区）：

|      | e2e 行数 | 测试 | 全仓   | 全仓测试 |
| ---- | -------- | ---- | ------ | -------- |
| 之前 | 17,456   | 174  | 30,271 | 460      |
| 之后 | 13,221   | 147  | 26,059 | 434      |
| 变化 | −4,235   | −27  | −4,212 | −26      |

- 全仓比 e2e 少减 23 行，是上传上限那条单测。
- 共享模块不计入：`sessions.ts`（新，86 行）、`fixture-controls.ts`（新，55 行）、`turn-observers.ts`（+106）、`permission-receipt.ts`（+2）。
- 比预测的约 13,760 多减了约 540 行：65 个 spec 改用共享 helper，实际收掉的本地副本比按族估的多。

**大小上限（先于删除）**：

- artifact-preview「keeps a structured write artifact…」：交付超过 32
  MiB 的文件，提示太大不预览，不读 `/api/files`，下载拿到原文件。
- `attachment-drafts.test.ts`：图片超过 `MAX_IMAGE_BYTES`、其他文件超过
  `MAX_UPLOAD_BYTES` 判为 `too-large`，正好等于上限的图片仍可加入。
- 两条都做了变异证明。

**并入和删除**：

- 11 条并入都先落进保留测试，每条做了变异证明（弄坏什么、红在哪一行，见 PR 说明）。
- 然后删 A 档 22 条、B 档 5 条，整文件删掉 4 个：handoff-origin、modal-a11y、multi-session-fence-soak、takeover-layout。
- 其余 11 条 A 档删除：映射到的测试都在共同的变异下变红；modal-a11y、driver-discovery 的 MALFORMED、peer-activity 第二条本身在那个变异下就不红，比映射测试更弱。
- final-reading 的 code copy 失败测试按批复保留，两种负例都在。

**修剪**：按各 spec 的「修剪」说明做。有意没删的：

- cron 的 weekly 路径：唯一检查星期到 cron 表达式的映射；
- peer-readonly 的 4b 步：「Esc 在 peer 上什么都不发」的正向对照；
- surface-recovery 的刷新后如实提示文案；
- mobile-remote 的 deny；
- template-launch 的第二次刷新；
- local-preferences 的草稿一段。

**共享 helper 和设计的出入**：

- `sessions.ts`：侧栏、会话行、选中、`newSessionIn`、输入框、`sendPrompt`、`openSettings(page, section?)`。
- `fixture-controls.ts`：扣住和放开 terminal、`disconnect`。
- `turn-observers.ts`：`observeFrames`（`calls`、`replyTo`、`settled`）、`observeSent`、`observeTransports`、`trackRuntimeErrors`。
- 和上面「共享 setup 和 fixture 设计」的出入：
  - 连接仍用 `fixture-session.ts` 已有的 `startSession` /
    `connectAndStartWorkspace`，没另造 `connectToChooser`；
  - `observeTerminals` / `observeHydrates` / `observeInteractions` 合成一个
    `observeFrames().calls(method)`；
  - `relay.ts`（`relayProtocol`、`holdReply`）没做：28 个 spec 的
    `routeWebSocket`
    各自扣不同的帧，通用代理省不了多少；需要同步点的两条（cron、session-panel）就地补了；
  - `openFromLink`、`browserStorage`、`secretVisible`、`holdTurnStart`、`fixtureDiagnostics`、`resetHolds`
    用的地方太少，没做。
- 保留在本地的 helper 都有原因：自己带断言的（如 interaction-ownership 的
  `nextPendingQuestion`）；共享版会让断言变弱的（断言数为 0 的地方用
  `.composer textarea`
  或按角色找的输入框）；故意不同的流程（只连不开会话、键盘操作、预期失败的连接）。
- peer-controller 保留本地的 `wire` /
  `projectSent`：换成共享观察器会改变非字符串值的投影。
- driver-discovery 和 peer-control 原来的应答投影（只核 fixture 自己的回复）在修剪里删了。

**加固**（逐条变异核实）：

- 红了就保留：diff-review「Changes works before a turn…」去掉
  `requestIsCurrent()` 后 3 次都红，测试不改。
- 补了断言，原测试抓不到的变异现在会红：
  - conversation-search：计数改成精确的 `1/N`，加「搜不到显示 0」；
  - surface-recovery：回到发起的对话看到「Copied」；
  - tab-lock：在被锁的标签页回车，不发 `turn/start`、文字保留；
  - native-workflows「native agent receipts
    settle…」：迟到的 status 读在重新读取之前检查，不得装上关闭前的状态。
- 调整顺序：resume-and-reasoning「canceling a held historical
  open…」的选中和草稿检查移到测试自己点击之前。App 还有一层守卫，单层变异抢不走选中，新旧两版都绿。
- 改标题，与断言一致：
  - connector-oauth「a restart-pending sign-in keeps its restart note across
    refreshes」；
  - connector-management「…releases busy state when it lands」；
  - connection-storage「a 51st unsent draft evicts one older draft…」；
  - diff-review、approval-clarity、mobile-handoff 合并后的标题。

**请 lead 下一轮定**：cron「ignores a late create
response…」和 session-panel「Files ignores a late
listing…」。两条都补了同步点，但去掉守卫仍绿：从 UI 换会话或换根都会卸载组件，这两道守卫走不到。现在留着，是因为它们是这条迟到路径唯一的 e2e；下一轮可以删，或者改成单测。

**T-0586 已处理**：两条都删了。cron 真正的保护是换会话时关掉定时任务页，原来没有任何测试守（去掉它，cron-create-delete 和另外 6 个用到产品页的 spec 全绿），改在「creates
At, Every and Cron
jobs…」最后加一步直接断言，变异会红。Files 有四层互相独立的保护，去掉其中三层仍绿，UI 上没有能抓的回归，只在上面的行里记下证据。
