# Changelog

## v0.22.0 — 2026-11-12

### 记忆可以编辑和删除

- 设置 › 记忆里的长期记忆按条显示，每条可以编辑、删除。删除前会先确认；改完、删完都会从服务器重新读一遍。
- 别处已经改过这条时，页面显示服务器上的新内容，你的草稿保留，可以再存一次。服务器拒绝或结果不明时，草稿也不丢。
- 可以把当前搜索结果或打开的记忆导出为 JSON 或 Markdown；导入时先完整预览再写入。导入结果不明时标“不确定”并读回核对，不会自动重发。
- 需要较新的内核（见“内核要求”）；旧内核上仍是只读，并说明不能编辑。

### 技能按审查结果安装

- 安装前先审查：页面列出服务器报告的来源、版本、权限和会运行的代码，并明确说明这些都是服务器报告的，没有人替你检查过源码。
- 只有服务器能锁定审查过的那个提交和校验值（带二进制时还要有本平台的签名包）时才提供“安装”。服务器装的就是这一份；注册表或下载内容在审查后变了，就拒绝安装并说明原因。结果不明时如实说“不确定”，不会自动重试。
- 装好的技能显示实际安装的提交，刷新后也一样，可以移除。不满足条件的来源（包括目前公共注册表里没有登记审查提交的条目）只能审查，不能安装，页面会写明原因。
- 输入框和手机上都能直接运行技能动作，并跟踪后台任务的进度和结果。

### 扫描 PDF

- 黑白扫描件（CCITT、JBIG2）和 JPEG 2000 扫描件不再显示成空白页。
- 没有文字层的页面可以在“页面文字”里点“识别第 N 页的文字”：在本浏览器里识别，文件不上传，也不调用模型。可选英文，或中文和英文；显示进度，可以取消。
- 结果标出置信度，置信度低时提示对照原页核对；读不出时说“没有识别出可靠的文字”。识别资源第一次识别时才下载：英文约 6
  MB，加中文再多约 1.7 MB。

### 断线和更新时不丢会话

- 网络断开或内核重启时，对话和侧栏里的会话都留在屏幕上，输入框换成“正在重新连接”提示；写了一半的草稿保留，连上后可以接着发。
- 服务器上的网页更新后，开着的窗口再打开新界面时会说明“Octoscode 已在服务器上更新”，重新加载即可使用新版本；并写明重新加载会保留已保存的草稿，等待发送的消息会丢失。
- 网页可以安装成桌面应用（PWA），窗口长时间开着也适用以上行为。不使用 Service
  Worker，不做离线缓存。

### 附件

- CSV、Markdown、文本和 PDF 可以拖进对话、粘贴，或点“文件”选择；输入框里能看到每个文件的上传状态，可以移除或重试，没传完不会发送。
- 发送后对话里能预览和下载附件，刷新后还在。停止回合时，附件和文字一起回到输入框。
- Office 文件仍不支持，选择时会说明，并建议另存为 PDF 或 CSV。

### 撤销和重做

- 回合摘要里可以撤销这一轮，之后可以重做；内核拒绝时说明原因，不假装成功。手机上也可以撤销和重做最近一轮。
- 重做时带上原来的附件和中途补充的话。

### 只读会话

- 只读会话里写文件失败时，马上提示，并提供“切到写入并继续”：按原要求重做这一轮，联网设置不变。也可以选择保持只读。
- 新会话的权限默认值确认之前不能发送，服务器拒绝时会显示出来。

### 发送前估算

- 输入框里有字时，旁边显示“本条约 N
  token”，点开能看到这条消息、已有上下文和发送后约占上下文窗口多少。都是估算，写明了算法；不显示金额。
- 快到服务器的压缩阈值时会提示服务器会先压缩较早的内容。切换会话后仍显示该会话最新的数。

### 专家团

- 侧栏的“专家团”可以选一个内置团队（方案评审、调研、代码体检、文稿打磨、数据清洗、文档交付），写下要处理什么，同时启动几位专家；开始前可以调整每位的分工。
- 页面显示每位专家的状态、结果和用量；可以打开某位的对话或停止。刷新后从服务器读回真实状态，不会自动停止任何专家。
- “汇总到当前对话”只汇总有结果的专家，并说明哪几位没有结果；数据清洗和文档交付只生成新文件，不改原文件。

### 连接器

- 需要登录的连接器可以在连接器页里授权、撤销授权；过期、被拒、超时都会写明原因，并且可以重新授权。令牌只在内核里，浏览器拿不到。
- 可以从服务器允许的列表里添加 stdio 连接器，不能填任意命令。新建的连接器保存后立即显示，需要重启才生效时会写明。

### 定时任务

- 侧栏有了单独的“定时任务”页：选每天、每周、每隔一段时间或只运行一次，再选模板或自己写，就能排上；也可以删除。Cron 表达式和时区放进高级选项。
- 列表显示下次时间和上次结果，结果看的是那次运行的真实回合；点“查看结果”跳到对应位置。时间按服务器的时钟算。

### 模板和用量

- 模板首页支持搜索、按“代码 / 办公 / 通用”分场景、收藏和最近使用；从模板开始时保留已写的内容。手机上也能从模板开始。
- 新的“用量”页按会话、模型和日期显示服务器记录的用量，按服务器的 UTC 时钟分期。

### 手机遥控

- 电脑上的工作可以交给手机继续：在对话菜单里选“在手机上继续”，用链接在手机上打开，接着跟进这个会话；手机上也可以在关注的文件夹里新建会话。
- 手机上的审批只能批准这一次，提权类审批只能拒绝；从总览点进会话会直接进入这个会话。

### 会话面板

- 文件页显示真实的工作区目录树，可以预览其中任意文件；切换标签页和刷新后，选中的文件保持不变。
- 文件损坏或太大时，预览会如实说明，并保留下载。

### 其他改进

- 跑过命令的回合不再说“改动 0 个文件”，改写“记录到 N 个文件，其他改动未统计”。
- 输入栏只显示服务器能证实的模型信息。
- 会话打开失败时保留原来的界面，可以重试；断线重连后，变更视图、回合耗时、文件交付顺序和停止状态都能恢复。
- 智能体（Peer）等你回答问题时，回答会被当作回答，不会当成批准；刷新后 Peer 的身份保持不变。

### 内核要求

- 最低支持的内核仍是 octos
  `v2.0.3`，新功能都在服务器提供对应能力时才出现，老内核会隐藏或保持只读，不会报错。
- 记忆编辑和删除需要 octos main `9a221b7a`
  之后的版本（octos#3179）；技能按审查安装需要 `aefdf9e4`
  之后的版本（octos#3183），并且注册表要登记审查过的提交。这两项还没有进入带标签的 octos 版本（`v2.1.0-rc.1`
  之后）。
- 扫描 PDF 识别需要部署时给 `/assets/ocr-` 目录加
  `'wasm-unsafe-eval'`（参考 nginx 已包含）；没有这一项的部署会提示“此服务器不支持”，其他功能不受影响。

### 已知问题

- 在部分模型上（实测 GLM-5.3），记忆页的“请求记住”提交后一直不生效，内核会在后台反复重试（octos#3253）。修好之前，请不要用它新增记忆。

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
