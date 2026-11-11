# Changelog

## Unreleased

### 扫描 PDF

- 黑白扫描件（CCITT、JBIG2）和 JPEG 2000 扫描件不再显示成空白页。原因是 pdf.js
  6 解码这几种图片要用它自带的解码文件，以前没有发布这些文件，图片被跳过，页面上也没有任何提示。现在随网页一起发布，作为普通 JavaScript 运行，不改 CSP。
- 没有文本层的页面，可以在「页面文字」里选择「识别第 N 页的文字」：在本浏览器里用 Tesseract.js 识别，文件不上传，也不调用模型。语言可以选英文，或中文和英文，默认跟随界面语言。识别时显示进度，可以取消。
- 结果标出置信度。置信度低时提示对照页面核对；几乎读不出时说「没有识别出可靠的文字」，不说页面没有文字。服务器不支持、超时、失败和取消都有各自的提示，并且可以重试。
- 只识别当前页，按预览的像素上限（约 4
  MP）渲染。每个打开的文件最多一个识别线程；取消、超时、收起「页面文字」、换文件或关闭预览都会结束线程，空闲一分钟后也会结束。结果只保存在内存里，跟随这个文件。不写入 Cache
  Storage、IndexedDB 或 localStorage，也不请求第三方地址。
- 识别资源（引擎 2.9 MB、英文 3.0 MB、中文 1.7
  MB）在第一次识别时才下载，带内容哈希、长期缓存。参考 nginx 只给这个目录加
  `'wasm-unsafe-eval'`，页面的 CSP 不变。

### 发送前估算

- 输入框里有字时，旁边显示“本条约 N
  token”，点开能看到这条消息、已有上下文和发送后约占上下文窗口多少。都是估算，写明了怎么算的：按字数，和服务器估算上下文的方法相同，模型实际的计数会有出入。
- 已有上下文用服务器自己的估算。回复过一轮后，用的是服务器上一次发给模型的内容（含系统说明和工具说明），来自内核的
  `context/state_reported`；之前用会话打开时读到的对话估算，并写明不含系统说明和工具说明。上下文窗口要等这个会话在本页收到回复后才知道，之前不显示百分比。
- 加上这条消息会达到服务器报告的压缩阈值时，提示会变色并说明服务器会先压缩较早的内容。阈值只用服务器给的数，不自己猜比例。
- 不显示任何发送前的金额：这里没有可靠的单价。模型的回复、这一轮的工具调用和附件都不计入，附件会单独写明。
- 输入框为空时不显示；停止输入 0.3 秒后才计算；换会话时不带上一个会话的数。草稿不写进任何新的存储。
- 切到别的会话再切回来，仍显示这个会话最新的上下文和窗口，不会退回打开会话时读到的旧估算。这些数只在本页内存里按会话保存，刷新后要等下一次回复。

### 专家团

- 侧栏有了“专家团”页面：选一个内置的专家团（方案评审、调研、代码体检、文稿打磨，各 3 位专家），写下要处理什么，就能同时启动几位专家。页面上写明每位专家负责什么，以及消耗大约是直接问一次的 4 倍。
- 用的是现有的 `peer/prepare`、`session/open`、`turn/start` 和
  `peer/gather`，没有新协议。服务器不提供这些方法时不显示入口。
- 每位专家在自己的对话里工作，页面显示每位的状态（工作中、等你处理、已完成、失败、已停止）和结果，可以打开某位的对话，也可以停止。失败时写明原因，内核原话收进“技术详情”。
- “汇总到当前对话”只汇总有结果的专家，并告诉模型哪几位没有结果，不把报错当成结论。
- 刷新页面后，专家团从服务器读回来。本页没有在跟的专家，会去读它自己对话的最后一轮来判断状态：还在跑的显示“工作中”，并且可以停止；停过的显示“已停止”，失败的显示“失败”，从没开始的显示“没有启动”。读不到时才显示“还没有结果”，不去猜。刷新、重连都不会自动停止任何专家。
- 刷新后点“停止”，停的是这位专家正在跑的那一轮（`turn/interrupt`，带上那一轮的编号）。这期间如果它已经结束或换了新一轮，服务器会拒绝，页面重新读一次状态，不会停到别的专家或新的一轮。用的是现有的
  `session/hydrate` 和 `turn/interrupt`，不改内核。
- 汇总只读真正有结果的专家：对话已经完成、但结果还没写到服务器的，算作没有结果。
- 服务器拒绝启动时（比如成员重名）什么都不会创建，页面说明原因，可以直接重试；重名会自动换一个编号重试一次。

### 连接器授权

- 需要登录的连接器现在能在连接器页里授权：点“授权”，在弹出的窗口里登录并同意，回来后这一行会显示“已授权”。用的是内核已有的
  `mcp/oauth/start`、`complete`、`cancel`、`revoke`，服务器不提供这四个方法时不显示入口。
- 内核报 `Auth required` 或 `no stored OAuth tokens`
  时，这一行标“需要授权”，原始错误收进“技术详情”。
- 取消、在授权页被拒绝、换取授权失败、授权超过 10 分钟，都会写明原因，并且可以重新授权。授权过的连接器可以撤销授权。
- 需要重启才生效的服务器上，授权后写“已授权，重启服务后生效”。
- 令牌只在内核里，浏览器拿不到。授权页返回的地址在回调页渲染前就从地址栏去掉，不写进浏览器存储或日志。授权窗口和本页的联系在打开授权页之前就切断了，所以取消后要自己关掉那个窗口。
- 服务器不接受本页作为返回地址时，改用内核的手动方式：把授权后的地址粘贴回来。
- 刷新页面后，等待中的授权会作废，回调页会说明。页面不再知道哪个连接器用了授权，直到它的某次修改的回复里带上这一点，那之前不显示“撤销授权”。

### 连接器

- 新建连接器保存后立刻显示一条待生效的记录，不再像保存失败那样从页面上消失。它可以编辑、停用和删除。
- 文案看内核的回答：这台服务要重启才会加载时写“已保存，重启服务后生效”。内核虽然同时回了
  `effective_from: next_turn`，但实测跑了两个回合也没有加载，所以只有不需要重启时才写“已保存，下次回合生效”。
- 已列出的连接器停用、删除、重新连接后，如果要重启才生效，页面会说明，不再什么反应都没有。
- 列表为空时不再说“未配置”：列表只显示已加载的连接器，所以改说“还没有加载”。
- 待生效的记录只在当前页面：内核没有列出已保存配置的方法，刷新页面后要等加载出来才会再显示，配置本身还在。

### 定时任务

- 侧栏有了“定时任务”入口，打开是一个单独的页面，不再藏在设置里。
- 选“每天”“每周”“每隔一段时间”或“只运行一次”，再选“写周报”“跑测试并汇报”或自己写，就能排上。Cron 表达式和时区放进了高级选项。“投递方式”去掉了：只发通知的任务在网页会话里什么也看不到。
- 任务名是消息的第一行，不再是整段原文。
- 列表自动刷新，显示下次时间和上次结果。结果看的是那次运行的真实回合：模型调用失败就显示失败和原因，不会因为任务已投递就写成功。
- 点“查看结果”跳到那次运行所在的会话和位置。
- 一次运行只对应“服务器自己开始、并且在运行后 15 秒内开始”的回合，绝不会对应你自己发的消息。只发提醒、不开始回合的运行，显示“已运行，没有在这里开始回复”；两次运行离得太近分不清，或者回合来得太晚，就如实写明分不清，不再按先后顺序硬配，所以一处配错不会连带后面全错。已经配上的结果，之后读到的数据就算缺字段也不会被清掉。
- 时间按服务器的时钟算，不看浏览器的时钟：服务器的当前时间从任务列表推出来（下次运行时间和“还剩多久”都是服务器给的），浏览器时钟差一小时也不会一直显示“运行中”或反复重读。推不出服务器时间时（比如任务都停用了），显示具体日期时间，不显示“几分钟前”。

### 回合摘要

- 用命令改的文件现在也算进摘要：内核量到几个就记几个。
- 跑过命令的回合不再说“改动 0 个文件”：内核只比较命令前后的
  `git status`，改已经改过的文件、删未跟踪文件它都量不到，所以它的数字只是下限。摘要改写“记录到 N 个文件，其他改动未统计”；一个也没记录到就写“改动未统计”。
- `/undo`、`/rewind`、`/fork` 的弹窗不再显示内部会话 ID。

### 附加文件

- 停止回合时，附件和文字一起回到输入框，再发不用重新上传。
- 只读时点“切到写入并继续”，重做的是整个请求：原来的文字、中途补充的话和附件都带上；输入框里正在写的附件不受影响。
- CSV、Markdown、文本和 PDF 可以直接拖进对话、粘贴，或点输入栏的“文件”选择，不用先把文件放到服务器上。图片也走同样的流程，不再弹窗，也不用再点一次上传。
- 输入框里能看到每个文件的名字、大小和上传状态，可以移除，上传失败可以重试。文件没传完时不会发送，写好的内容也不会丢。
- 发送后对话里能看到这条消息附了什么，可以预览和下载，刷新后也还在。附件不再算进“产出文件”。
- Office 文件仍然不支持，选择时会明确说明，并建议另存为 PDF 或 CSV。
- 拖放范围扩大到整个对话区，拖偏了也不会把页面跳走。“写周报”和“整理表格”模板的提示也改成可以直接拖文件。

### 只读会话

- 只读会话里写文件第一次失败时，对话底部马上提示“现在是只读，Octos 改不了文件”，并给出“切到写入并继续”：停下这一轮，切到写入，按原要求重做，联网设置不变。原来的重试按钮藏在折叠的工具行下面，而且在真实服务器上常常不出现。也可以点“保持只读”。
- 只有审批卡片时，这条提示显示在卡片里。
- 选只读模板时，提示里会说明这个会话现在是只读。模板仍然不会自动提升权限。

### 手机遥控

- 手机上的智能体（Peer）审批也只能批准这一次，沙箱提权类审批只能拒绝，和会话里的审批卡片一致。
- 在总览打开侧栏点一个会话、或者新建会话，现在会进入这个会话，不再停在总览上。

## v0.21.0 — 2026-11-01

### 产物预览

- 交付文件和后台任务产物可以直接预览 PDF、CSV、图片、HTML/SVG、Markdown、代码和纯文本；Office、过大或无法预览的文件仍保留下载入口。
- CSV 使用有界工作线程解析，PDF 逐页渲染；HTML/SVG 在禁脚本、禁网络的沙箱中打开。文件卡保留类型、大小和清晰的展开/收起操作。

### 连接器管理

- 设置里可以查看 MCP 连接器状态，并按服务器能力启用或停用已有定时任务。
- 新增、删除、编辑、OAuth 和新建定时任务在协议未提供时明确显示为不可用，不伪造成功状态。

### 自动化标签

- 会话面板新增自动化标签，集中查看和控制目标、循环、监视器与智能体，并接收实时进度。
- 标签只在服务器支持时出现；尚未打通的目标账本和监视器沙箱限制会如实说明。

### 会话整理

- 侧栏支持按工作区浏览、搜索、排序，以及会话重命名和删除；操作后同步服务器目录并恢复焦点。
- 长标题、运行状态和手机布局保持一致，重命名/删除只在对应内核能力存在时显示。

### 执行过程更清楚

- 工具名称、每轮耗时、文件与 token 摘要、失败原因和等待状态更易读；计划、步骤和回放顺序保持清晰。
- 审批说明列出目录、联网和删除影响，可以直接处理权限不足后的重试。
- 会话设置可显示实际执行后端、Docker 镜像以及 Node.js、npm、Git、Python 是否可用。

### 第一眼和交互打磨

- 修复快捷键帮助、搜索、菜单等表面的缺失设计变量，补齐中文字体回退和明暗主题。
- 按钮、卡片和会话行新增一致按压反馈、可见焦点和真实忙碌状态；模板权限与只读提示更清楚。

### 首次向导

- 模型服务改为两步设置，保留少量推荐提供商，其余收入“更多提供商”，并支持自定义 OpenAI 兼容地址。
- 服务器文件夹可浏览、新建并一步启动会话；手机不再叠加两层工作区界面，重复目录会合并。

### 手机遥控

- 打开 `?view=remote`
  即可在手机上查看等待处理、运行中和最近完成的会话，并进入对应会话。
- 支持允许一次或拒绝审批、发送追问和停止运行；断线时保留列表但禁止操作，恢复后继续，不重复发送。
- 手机端不会提供更宽权限；提权和联网等操作仍留在电脑上完成。

### 内核要求

- “执行环境”显示需要 octos main `2510fb827`
  之后的版本（octos#2928）；老内核会自动隐藏这一块，不会报错。其他能力同样按服务器广告启用。

## v0.20.0 — 2026-10-29

Stabilize the v0.11.0 line for the 0.20 readiness declaration without pulling in
next-version feature work.

- Upgrade the development toolchain and Playwright coverage, and close the
  remaining accessibility label/name and keyboard-focus regressions.
- Reconfirm long-history, multi-Session selection and real-Core recovery
  acceptance, including the real-model live gate and exact deployed artifact
  checks.
- Add an interrupted-turn durability probe. The post-stop refresh variant passes
  twice against `octos-main-ce2c99bc` with octos#2849 included.

Known issues:

- Post-stop refresh durability requires a Core containing octos#2849. The
  still-running refresh variant remains `test.fixme` pending octos#2881, because
  the disconnect path can drop the dispatched prompt; #78 stays open for that
  remaining Core work. No client-side data recovery is claimed.

## v0.11.0 — 2026-10-18

First stable 0.11.0 release, promoting v0.11.0-rc.3 with the hardening that
landed on main since the candidate. The verified Core runtime and UI Protocol
contract pins advance from v2.0.3-rc.13 to v2.0.3.

- Interrupting a running turn no longer leaves a stale retry path: the steering
  delivery view carries a staleness guard, and the Retry-queued-delivery
  dispatch has a regression test.
- Taking over a Session held by another tab returns focus to the composer so
  keyboard users can continue typing immediately.
- Search input polish with a clearer no-match signal, the match count stays
  hidden until a query exists, and the case-sensitive toggle persists across
  reload.
- Commands and search wording is fully translated, including the zh follow-ups
  for the reworded steer entry and the commands section title.
- Redaction tests now cover the access_token and apikey patterns.

## v0.11.0-rc.3 — 2026-10-13

- Keep Changes is available before the first turn: switch between the session
  preview and uncommitted workspace changes, refresh the snapshot, and review
  diffs before asking for the next change.
- Enter now steers a compatible running turn by default instead of queueing:
  matching reasoning effort remains steerable, while attachments and changed
  effort queue as before. Tab queues deliberately, and Send now interrupts the
  active turn and releases pending input after it settles. When a steering
  result is inconclusive, queued prompts pause and a Retry-queued-delivery
  control appears in the steering notice.
- Search the current conversation with ⌘F/Ctrl+F: matches highlight in place,
  Enter walks them, Shift+Enter walks back, and Escape clears the query before
  closing. Aa toggles case-sensitive matching; match progress is announced to
  screen readers; the bar also opens on a fresh empty session and swings back
  from the Trajectory tab.
- Opening a Session that another browser tab already holds shows a takeover
  banner; sending — including the Send-now interrupt control — stays blocked
  there until you take over, and the previous tab sees that it lost the session.
- Press ? outside text inputs to list global shortcuts plus the mid-turn
  composer controls.

## v0.11.0-rc.2 — 2026-09-24

- Rebuild the 0.11.0 candidate from its tagged source. The rc.1 artifact was
  withdrawn because its build revision did not match its tag.
- Validate the browser client against Octos v2.0.3-rc.13 and pin that Core
  runtime and UI Protocol contract for this release. The Core update keeps local
  Solo Sessions in-process when its profile watcher runs.

## v0.11.0-rc.1 — 2026-09-24

- Stop a local `octos serve --solo` from Settings when the server advertises
  `server/shutdown`: a confirmation dialog guards the stop, a failure keeps the
  session connected, and success disconnects the tab to the connect screen.
- Preserve unsent drafts across same-tab refresh, isolate them by sign-in and
  Session, and report browser storage failures without silently losing editing
  state.
- Keep earlier drafts at the cache limit and make failed Forget operations
  visible, including browsers that reject storage reads or deletions.
- Add unread tab counts and explicitly enabled desktop notifications for hidden
  or background responses; suppress historical/repeated notifications.
- Improve diff review with syntax highlighting and conservative word changes,
  retaining full raw text when highlighting is unavailable or the preview is
  large.
- Bound silent connection handshakes and consume newer Core canonical hydrate
  replay without changing attached execution or old-server capabilities.
- Add continuous Firefox/WebKit critical-flow checks alongside the Chromium
  suite.

- Preserve active work, drafts and queued messages when an optional view fails
  to load; make modal loading cancellable and keep recovery actions available.
- Resolve uncertain turns through the advertised status query without automatic
  resends; retain their records across reconnect and block unsafe navigation.
- Correct late-response/socket ownership and queue settlement ordering, and
  preserve canonical transcript text and terminal states.
- Improve direct workspace entry, mobile navigation and control reachability,
  IME editing, nested modal focus, queued-message removal and reader-controlled
  transcript scrolling and disclosures.
- Keep received conversation history available through incremental expansion,
  support confirmed cross-browser conversation links, and report clipboard
  results truthfully without writing late feedback into another session.
- Run the complete interaction and visual browser suite in pull-request CI;
  retain the existing JavaScript, CSS and long-frame budgets.

- Restore a successful runtime/workspace/session connection across refresh with
  tab-scoped credential retention, explicit forgetting, and canonical
  server-returned identity.
- Replace client-entered protocol ids with a profile-neutral `web-<uuid>` launch
  intent, then bind it to `<resolved-profile>:api:web-<uuid>` before
  `session/open`; restored Sessions reopen by their committed server identity
  without inheriting a stale active Profile.
- Fail closed on Core rc.9's unscoped `session/list` rows: show only the
  successfully opened or restored Session until Core returns an authoritative
  Workspace/Profile-scoped SessionRef catalog.
- Add an opt-in GLM-5.3-Flash live gate that authenticates, creates and verifies
  a bounded workspace file through real Core tools using the production static
  build, then proves refresh recovery.
- Replace the diagnostic shell with DSH-aligned Workspace/Session navigation,
  composer permission/runtime controls, and General/Models settings; defer
  non-primary surfaces so the initial production bundle stays inside budget.
- Replace scattered connection/recovery refs and turn handling with directly
  tested lifecycle controllers and grouped session domains.
- Validate every structured request result, quarantine late RPC responses, and
  centralize shared wire decoders and generated Core method vocabulary.
- Add focus-trapped modal semantics, dark/light WCAG gates, accessible diff and
  command widgets, token-only feature styling, and explicit bounded-history
  disclosure.
- Harden deployment and publication with a strict CSP, checked nginx syntax,
  exact toolchain/action pins, separate publish authority, immutable assets, and
  build provenance attestations; generate and verify the production dependency
  license closure in every release.

## v0.1.0-rc.2 — 2026-08-26

- Record both the generated protocol source pin and checksummed released Core
  runtime baseline in the deployed build manifest.
- Mark release-candidate tags as GitHub prereleases and ship security/changelog
  metadata with the static archive.
- Make settled Markdown links, syntax tokens, and task-list controls pass the
  deterministic light-theme WCAG 2/2.1 A/AA gate.

## v0.1.0-rc.1 — 2026-08-26

First release candidate of the standalone Octoscode browser client.

- Durable UI Protocol hydrate, cursor replay, dedupe, reconnect, and gap repair.
- Octoscode-compatible prompt queue, interrupt, launch, approval, question, and
  canonical coding-session semantics.
- Safe Markdown/code transcript, server-owned permissions and diff review,
  plans, tasks, paged output/artifacts, context/cost/model status, and bounded
  cross-session activity.
- Session navigation with per-session drafts and capability-gated Core forward
  methods.
- Browser-first solo profile/provider onboarding with transient credentials,
  provider test-before-save, partial-failure recovery, and a TUI fallback.
- DSH-derived visual language with the MIT notice preserved.
- Strict protocol decoders, generated Core vocabulary, pinned checksummed real
  Core integration, Chromium/WCAG gates, hardened deployment reference, and
  versioned static release artifacts.
