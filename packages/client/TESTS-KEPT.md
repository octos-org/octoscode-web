# packages/client 保留清单（T-0502，shu 11-07 新法）

本清单是 `packages/client`
全部测试的**唯一保留清单**，为 T-0503 整批删除定边界。**不在清单内的测试默认后续全删**，不逐条写删除理由。

判定依据 `wake/lanes/TEST-DIET.md` 第 1–5 类：

- **① 跨系统链路（OUP 协议契约）**：客户端与服务端对同一帧的理解一致；wire 形状、正例解析、分页/游标链。
- **② 跨功能**：两个功能互相影响。
- **③ 安全边界**：身份/scope 归属、能力门控（fail-closed、零线流量）、凭据/secret/proof 不泄漏、注入与字节边界。每类留最关键的一两个。
- **④ 帧解析 / 并发 / 数据完整性**：严格解码拒绝畸形、u64 精度、freeze/detach、竞态（迟到应答、post-send 变更不可重定向）、恢复。
- **⑤ 有意设计例外**：带注释/链接的设计决定（不默认预算、CAS 元数据非权威、keyless 语义、Rust
  uuid 解析 parity 等）。

规则补充：一个方法一个测试、逐字段/结构绑定不保留；同守卫的参数变体（it.each 展开、换形状、换方法）只留代表；真实跨系统链在 T-0503 可按链合并剩余保留项。

## 基线与预计

- 基线（origin/main `7779b9f`，`python3 wake/test-lines.py`）：packages/client
  **13,256 行测试 / 486 个**；全仓 95,108 行 /
  2,728 个（@2e80cbe，中间 #407/#409/#410 非测试改动）。
- 本清单保留
  **约 185 个测试**。预计保留范围：**5,500–7,000 行**（保留项多为大解码链，删的多为小矩阵；T-0503 后实测回填）。

## 保留清单

### tests/autonomy-controls.test.ts（留 4/14）

| 测试                                                                                  | 类  | 守的性质                    |
| ------------------------------------------------------------------------------------- | --- | --------------------------- |
| ordinary goal set explicitly activates as user and preserves only an explicit budget  | ⑤   | goal 不默认预算的设计       |
| uses full captured request scope and validates actual native child ownership          | ③   | 原生子代理归属校验          |
| never exposes unredacted nested artifact content or treats missing content as success | ③   | 嵌套产物内容脱敏/缺失不成功 |
| rejects opposite control transitions, false ok and contradictory terminal flags       | ④   | 非法迁移 fail-closed        |

### tests/autonomy.test.ts（留 12/26）

| 测试                                                                                  | 类  | 守的性质                                           |
| ------------------------------------------------------------------------------------- | --- | -------------------------------------------------- |
| requires both the method and its gating feature                                       | ③   | 方法与 feature 双重门控                            |
| accepts only the exact owning session                                                 | ③   | 只接受精确属主会话                                 |
| parses goal get/set/clear results and rejects malformed payloads                      | ④   | goal 帧解析正例+畸形 fail-closed                   |
| builds goal set params: trims, never defaults a budget, rejects invalid               | ⑤   | 不默认预算（构造侧）                               |
| admits only newer generations; 0 means legacy                                         | ⑤   | #1959 严格递增 generation 准入，0 为 legacy 未盖戳 |
| builds monitor create params without inventing options                                | ⑤   | 不虚构监控选项（无静默回退）                       |
| rejects a foreign owner or conflicting envelope ID in agent notifications             | ③   | 通知归属/envelope 一致性                           |
| dispatches each autonomy notification method                                          | ①   | autonomy 通知分发链                                |
| accepts list/control/fire results carrying nulls                                      | ④   | rc12 显式 null 线形状                              |
| base-key matching mirrors Core: topic scope sees its base session                     | ③   | scoped list 的 base-key 镜像 Core 语义             |
| scopes a %s list to its base/topic children and enforces the envelope echo（it.each） | ③   | 越界子记录过滤 + envelope 精确回显                 |

### tests/client.test.ts（留全部 19 条 + it.each 链）

T-0491 已按本法拉过一轮，现存每条都是独立守卫：turn scope 生命周期协商、close
frame 携带、pending 拒绝、静默握手超时与迟到回调、取消连接不污染替代、canonical 响应方法、畸形类型结果拒绝、惰性解码校验、JSON-RPC 失败保留、非文本帧/重复连接、超时后迟到应答隔离、LLM
probe 长超时（⑤）、session/open 立即派发+通知送达、hydrate 校验、冷解码 mutation 不重放（⑤）、权威产物请求 wire 契约、session/title.set
echo、profile 模型管理 wire 契约。it.each「replaced socket late callback
×4」按一条竞态守卫计。P2d external_driver 严格 opt-in（⑤，contract 2800
§1）保留。

### tests/coding.test.ts（留 4/8）

| 测试                                                              | 类  | 守的性质                     |
| ----------------------------------------------------------------- | --- | ---------------------------- |
| pins each fixture to an exact octos core contract blob            | ⑤   | fixture 锚定 core 契约 blob  |
| decodes permission list and mutation results                      | ①   | 权限线协议解码               |
| decodes diff previews without narrowing forward-compatible labels | ④   | 前向兼容标签不收窄           |
| fails closed on unknown permissions and malformed preview ids     | ③   | 未知权限/畸形 id fail-closed |

### tests/context.test.ts（留 3/7）

| 测试                                                             | 类  | 守的性质                     |
| ---------------------------------------------------------------- | --- | ---------------------------- |
| projects only bounded diagnostic labels and authoritative counts | ③   | 诊断投影有界                 |
| rejects wrong-session and stale lifecycle notifications          | ③/④ | 跨会话/过期生命周期通知拒绝  |
| permits a failed compaction to retry at the same generation      | ④   | 失败压缩同 generation 可重试 |

### tests/external-driver-control.test.ts（留 15/39）

| 测试                                                                                 | 类  | 守的性质                                             |
| ------------------------------------------------------------------------------------ | --- | ---------------------------------------------------- |
| ${name} fails closed when the feature is missing（it.each）                          | ③   | 门控离线 fail-closed                                 |
| sends the captured scope, fence id, expected_revision and lease                      | ①   | driverAcquire 线协议                                 |
| the decoded acquire capability is serialization-safe: no proof in JSON/debug         | ③   | proof 不进 JSON/调试视图                             |
| release sends the fence, expected_revision and explicit next mode                    | ①   | driverRelease 线协议                                 |
| dispatch sends the fence, operation id, exact model and target                       | ①   | peerDispatch 线协议                                  |
| re-invoking the SAME operation re-encodes identically and keeps the ORIGINAL receipt | ④   | 重放幂等，原回执不可变                               |
| control carries the accepted receipt facts and never the proof                       | ③   | control 回执无 proof                                 |
| claim sends the fence and treats the cursor as opaque                                | ①   | wakeClaim 线协议+游标不透明                          |
| dispatch rejects an adopted session that contradicts its slug                        | ③   | 畸形原生身份拒绝（无静默回退族代表）                 |
| dispatch decodes the accepted turn-id form ${form}（it.each）                        | ④   | 回执 turn id 覆盖 Rust UUID 全形状（control 变体删） |
| driverGet stays read-only: it never acquires and carries no proof                    | ⑤   | 只读面绝不隐式获取                                   |
| control methods require an explicitly supplied proof argument                        | ③   | proof 必须显式传                                     |
| refuses a control call with NO proof argument, offline (zero wire traffic)           | ③   | 无 proof 零线流量拒绝                                |
| a rejected control RPC never echoes the raw server payload or proof                  | ③   | 拒绝不反显服务器原文/proof                           |
| keeps the constructing session/topic for every control method                        | ④   | 构造期 scope 冻结，不重解析                          |

### tests/external-driver-lease-control.test.ts（留 4/12）

| 测试                                                                        | 类  | 守的性质                   |
| --------------------------------------------------------------------------- | --- | -------------------------- |
| accepts an external release: parked binding present with lease 0            | ④   | FROZEN release 形状        |
| rejects a FOREIGN next: requested internal but reply says external          | ③   | 外来释放模式拒绝           |
| post-send mutation of caller args cannot retarget wire or decode            | ④   | 发送后调用方变更不可重定向 |
| the acquire capability exposes no enumerable proof and errors never echo it | ③   | 能力对象无 proof 可枚举    |

### tests/external-driver-operations.test.ts（留 9/42）

| 测试                                                                         | 类  | 守的性质                       |
| ---------------------------------------------------------------------------- | --- | ------------------------------ |
| clamps nothing: limit 0, 101, fractional, negative, or null is invalid       | ③/④ | limit 边界不钳制只拒绝         |
| rejects empty or >4096-byte cursors                                          | ④   | 游标字节边界                   |
| keeps observed_revision a string; rejects number/float/leading-zero/overflow | ④   | u64 revision 精度不丢          |
| enforces complete iff next_cursor null (both directions)                     | ④   | 分页 complete iff 语义双向     |
| bounds the page on EXACT RAW snake_case serialization (256KiB)               | ④   | 原始序列化字节上限             |
| freezes and detaches nested rows/acceptance/scoped_goal                      | ④   | 嵌套视图 freeze/detach         |
| exposes no proof/prompt/answer anywhere in a parsed view                     | ③   | 解析视图无 proof/prompt/answer |
| pins Core wire constants                                                     | ⑤   | 与 Core 共享线常量锚定         |
| rejects a valid-native row on a FOREIGN master base (page-level)             | ③   | 捕获 scope 页级围栏            |

### tests/external-driver-peer-control.test.ts（留 8/26）

| 测试                                                                         | 类  | 守的性质                           |
| ---------------------------------------------------------------------------- | --- | ---------------------------------- |
| refuses when the feature is not advertised                                   | ③   | 能力门控最先（离线零 RPC）         |
| dispatch: a reply matching the MUTATED foreign operation/model is refused    | ④   | post-send 变更不可重定向解码围栏   |
| refuses a valid-SHAPE foreign-master receipt (same slug, other base)         | ③   | 回执围栏到捕获 master/profile      |
| rejects cross-variant command fields OFFLINE (zero RPC)                      | ③   | 跨变体命令字段离线拒绝             |
| a bad control fence reports peer/control, never peer/dispatch, and no proof  | ③   | 围栏诊断点名真实方法且不泄漏       |
| refuses a FOREIGN lane even when the resolved model LOOKS like the request   | ③   | 围栏请求的 lane 而非解析模型       |
| REJECTS caller-injected session_id/model/workspaceRoot OFFLINE (zero frames) | ③   | 注入字段离线拒绝                   |
| maps state:'refused' to ExternalDriverRefusalError('peer_control_refused')   | ④   | 类型化拒绝解码（非泛化 malformed） |

### tests/external-driver-receipt.test.ts（留 7/28）

| 测试                                                                | 类  | 守的性质                               |
| ------------------------------------------------------------------- | --- | -------------------------------------- |
| computes the worker session from captured master base + peer topic  | ①   | master base 对齐的核心推导             |
| rejects a same-profile DIFFERENT master base reply                  | ③   | 同 profile 异 base 拒绝                |
| accepts an ordinary channel/chat base exactly                       | ④   | 普通基形状接受（其余 base 形状变体删） |
| rejects whitespace/control bytes in the master base (receipt)       | ③   | 控制字节拒绝                           |
| requires the mandatory captured masterSessionId (missing/malformed) | ③   | masterSessionId 强制                   |
| requires a real protocol UUID TurnId for first AND duplicate        | ④   | 首回执与重放都要真 UUID                |
| flags each changed immutable field with a constant field name       | ④   | 重试不可变字段恒定命名诊断             |

### tests/external-driver-wake-control.test.ts（留 4/5）

| 测试                                                                             | 类  | 守的性质                                             |
| -------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| accepts exactly one of payload / continuation_ref (absent or null)               | ③   | decidable-content 规则（present/absent/null 全组合） |
| refuses ambiguous, empty, or unserializable content with a bounded typed failure | ④   | 环载荷等有界类型化失败                               |
| freezes a CLONE and leaves the caller's raw payload unfrozen                     | ④   | 克隆冻结不冻调用方                                   |
| preserves an own JSON "**proto**" key without prototype pollution                | ③   | 原型污染防护                                         |

### tests/external-driver.test.ts（留 16/61）

| 测试                                                                                                     | 类  | 守的性质                                         |
| -------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------ |
| requires BOTH the advertised method and external_driver_v1                                               | ③   | 双重门控                                         |
| maps a retained binding to the full canonical camelCase view                                             | ①   | driverGet 解析正例（各 scope 正例 it.each 并存） |
| rejects internal mode with a live lease (CAS metadata is not authority)                                  | ⑤   | CAS 元数据不是权威的设计                         |
| rejects unsafe wire integers without rounding u64                                                        | ④   | u64 不安全整数拒绝                               |
| keeps proof/hash/secret fields out of the parsed public view                                             | ③   | 解析公开视图无 proof/hash/secret                 |
| detaches acceptedWork from the server payload                                                            | ④   | acceptedWork detach                              |
| fails closed before any wire traffic when %s is missing（it.each）                                       | ③   | 零线流量 fail-closed                             |
| sends exactly the captured owning session/topic scope                                                    | ③   | 捕获 scope 精确发送                              |
| rejects an invalid topic scope BEFORE RPC instead of omitting it                                         | ③   | 非法 topic 上线前拒绝而非省略                    |
| sends ONE typed RPC for a valid operations request; missing inventory is an explicit unsupported failure | ①   | 单次类型化 RPC + 显式 unsupported                |
| throws constant diagnostics without echoing an untrusted payload                                         | ③   | canary 不回显不可信载荷                          |
| valid first page passes validated operations in the SAME single RPC as binding                           | ④   | 首页与绑定同帧                                   |
| mutating the caller options object mid-request cannot retarget params or fences                          | ④   | 请求中变更不可重定向                             |
| preserves an allowlisted kind from an ACTUAL OctosUiProtocolError                                        | ④   | 白名单 kind 窄化正例                             |
| rejects a duck-typed fake .data.kind lookalike (stays generic, scrubbed)                                 | ③   | 鸭子类型伪 kind 拒绝                             |
| rejects C0/DEL control bytes at every identity surface                                                   | ③   | 控制字节边界                                     |

### tests/history.test.ts（留 3/5）

| 测试                                                                    | 类  | 守的性质                          |
| ----------------------------------------------------------------------- | --- | --------------------------------- |
| rejects invalid topic bytes and out-of-range u32 counts before dispatch | ④   | 上线前字节/计数边界               |
| accepts only the owning hydrated thread on rewind                       | ③   | rewind 只接受属主 hydrated thread |
| uses server-created branch identity and native review identity          | ①   | 分支/评审身份由服务器铸造         |

### tests/hydrate.test.ts（留 4/5）

| 测试                                                                                | 类  | 守的性质                  |
| ----------------------------------------------------------------------------------- | --- | ------------------------- |
| parses authoritative messages and injects session scope into replay envelopes       | ①   | hydrate 正例 + scope 注入 |
| fails closed on malformed message rows                                              | ④   | 畸形行 fail-closed        |
| parses the explicit replay-loss signal                                              | ④   | 显式重放丢失信号          |
| rejects malformed, foreign, duplicate, or future replay before accepting its cursor | ④   | cursor 接受前重放围栏     |

### tests/inspection.test.ts（留 3/8）

| 测试                                                                                                | 类  | 守的性质                    |
| --------------------------------------------------------------------------------------------------- | --- | --------------------------- |
| reads remembered approvals with a method-only grant and exact scoped rows                           | ③   | 记忆审批读取的 scope        |
| rejects any foreign approval row, missing owner or malformed optional turn instead of partial lists | ③   | 外来行拒绝不给部分列表      |
| projects only audited context counts/labels and rejects contradictory nested ownership              | ③   | 审计投影 + 嵌套归属矛盾拒绝 |

### tests/interaction.test.ts（留 3/5）

| 测试                                                                      | 类  | 守的性质           |
| ------------------------------------------------------------------------- | --- | ------------------ |
| parses generic and typed approval requests without trusting typed details | ③   | 类型化细节不信任   |
| rejects malformed blocking requests                                       | ④   | 阻塞请求畸形拒绝   |
| tracks approval terminal notifications by id                              | ④   | 终态通知按 id 跟踪 |

### tests/inventory.test.ts（留 16/19）

T-0491 已合并同类项，现存几乎都是独立链：rc11 可空字段（④）、连接器配置/令牌不投影（③）、T-0056 管理事实白名单（③）、旧服务器无 facts（④）、只投影 status 字段+重复/错 scope 行拒绝（③）、畸形可空字段与 unsafe
counts（④）、门控+返回 scope 校验（③）、连接器管理 payload 精确（①）、Core
4748d11b 真实 create 结果（⑤）、#2912
method-capability 回退（⑤）、sign-in 只开网页（③
javascript:/data: 安全）、sign-in
payload 精确（①）、token_storage 不投影（③）、畸形 facts
it.each（④）、不可读 mutation 不给 connector 不报错（④）、stdio 连接器走 allowlist 绝不给 command（③）。

### tests/media.test.ts（留 3/5）

| 测试                                                                                      | 类  | 守的性质                 |
| ----------------------------------------------------------------------------------------- | --- | ------------------------ |
| obtains transfer credentials from the client without placing them in URLs                 | ③   | 凭据不进 URL             |
| keeps routing prefixes, rejects ambiguous endpoints and strips URL credentials/parameters | ③   | 端点边界与 URL 凭据剥离  |
| requires the upload handle to belong to the selected Profile                              | ③   | 上传句柄归属选中 Profile |

### tests/onboarding.test.ts（留 5/13）

| 测试                                                            | 类  | 守的性质              |
| --------------------------------------------------------------- | --- | --------------------- |
| preserves omission, null, zero, and closed rc11 inference hints | ④   | rc11 推断提示全形状   |
| projects the server-owned provider catalog into bounded arrays  | ④   | 目录投影有界          |
| rejects a malformed endpoint instead of guessing its identity   | ③   | 畸形端点不猜身份      |
| accepts a catalog-advertised keyless provider family            | ⑤   | keyless provider 语义 |
| decodes the secret-free detailed profile configuration          | ③   | 详细配置无 secret     |

### tests/peers.test.ts（留 4/9）

| 测试                                                                                         | 类  | 守的性质                 |
| -------------------------------------------------------------------------------------------- | --- | ------------------------ |
| uses the server profile in the native identity                                               | ③   | 原生身份用服务器 profile |
| fails closed before the wire for absent or explicitly unsupported methods                    | ③   | 上线前 fail-closed       |
| rejects the entire fleet for malformed/wrong-profile/duplicate children or inconsistent head | ③/④ | 舰队整体验证，坏孩子拒全 |
| requires originating session AND profile on durable notifications                            | ③   | 持久通知双归属           |

### tests/projection-inputs.test.ts（留 5/14）

| 测试                                                                           | 类  | 守的性质                         |
| ------------------------------------------------------------------------------ | --- | -------------------------------- |
| does not treat an unsupported or incomplete outcome as a terminal              | ④   | unsupported/incomplete 不当终态  |
| requires a structured terminal error without constraining its opaque data      | ④   | 终态错误结构化、不透明数据不约束 |
| rejects coercion-prone identities and tool names before the timeline sees them | ③   | 时间线前拒注入型身份/工具名      |
| bounds numeric payload fields without silently losing u64 precision            | ④   | 数值字段 u64 精度                |
| retains unknown event payloads for forward-compatible sequence tracking        | ⑤   | 未知事件保留以兼容未来序列跟踪   |

### tests/projection.test.ts（留 1/1）

| 测试                                                     | 类  | 守的性质                       |
| -------------------------------------------------------- | --- | ------------------------------ |
| fails closed when identity or payload fields are missing | ④   | envelope v2 缺字段 fail-closed |

### tests/protocol-id.test.ts（留 1 矩阵）

| 测试                                                                    | 类  | 守的性质                                                             |
| ----------------------------------------------------------------------- | --- | -------------------------------------------------------------------- |
| accepts/rejects/${label}/${baseName}+${termName} 循环矩阵（it.each ×4） | ④/⑤ | Rust uuid 1.20 try_parse 逐字节 parity（parser.rs 147-162 注释链接） |

### tests/research.test.ts（留 2/5）

| 测试                                                                                  | 类  | 守的性质                          |
| ------------------------------------------------------------------------------------- | --- | --------------------------------- |
| parses exact nullable fields, excludes unknown secrets and enforces owner/unique keys | ③   | research 线解码 + secret 排除     |
| gates before wire, requires credential destination and redacts an echoed secret       | ③   | 凭据目的地强制 + 回显 secret 脱敏 |

### tests/rpc.test.ts（留 2/2）

| 测试                                            | 类  | 守的性质           |
| ----------------------------------------------- | --- | ------------------ |
| parses notifications without inventing defaults | ④   | 通知解析不造默认   |
| rejects malformed envelopes                     | ④   | 畸形 envelope 拒绝 |

### tests/server-methods.test.ts（留 1/2）

| 测试                                                            | 类  | 守的性质                       |
| --------------------------------------------------------------- | --- | ------------------------------ |
| sends server/shutdown and resolves once the server acknowledges | ①   | 关机确认一次解析（拒绝变体删） |

### tests/skills.test.ts（留 3/4）

| 测试                                                                   | 类  | 守的性质                  |
| ---------------------------------------------------------------------- | --- | ------------------------- |
| accepts real explicit-null fields and whitelists projected metadata    | ④/③ | rc 显式 null + 投影白名单 |
| gates before dispatch and binds every read and mutation to the profile | ③   | 每次读写绑定 profile      |
| never force-overwrites and checks exact mutation receipts              | ⑤   | 不强制覆盖的设计          |

### tests/supervision.test.ts（留 2/4）

| 测试                                                                                 | 类  | 守的性质                |
| ------------------------------------------------------------------------------------ | --- | ----------------------- |
| decodes pinned task, output, artifact, and runtime fixtures                          | ①   | 监督线协议 fixture 解码 |
| tolerates the legacy unresolved-model status shape without hiding malformed siblings | ④   | 旧形状容忍不遮畸形兄弟  |

### tests/turn-state.test.ts（留 2/4）

| 测试                                                                       | 类  | 守的性质                      |
| -------------------------------------------------------------------------- | --- | ----------------------------- |
| accepts lifecycle metadata and ignores unrelated context extensions        | ④   | 窄契约：无关扩展忽略          |
| requires both negotiated feature and an advertised method without a denial | ③   | feature+method+无拒绝三重门控 |

### tests/url.test.ts（留 1/2）

| 测试                                                          | 类  | 守的性质                                      |
| ------------------------------------------------------------- | --- | --------------------------------------------- |
| turns an HTTP server origin into the AppUI WebSocket endpoint | ①   | origin→WS endpoint 构造（显式路径保留变体删） |

### tests/wire-decoders.property.test.ts（留 2/6）

| 测试                                                                 | 类  | 守的性质                           |
| -------------------------------------------------------------------- | --- | ---------------------------------- |
| parseUiCursor: never throws for arbitrary input                      | ④   | 任意输入不抛（property）           |
| isNonNegativeInteger: rejects non-integers, negatives, NaN, Infinity | ④   | 非负整数谓词边界（其余谓词变体删） |

### tests/workspace-browse.test.ts（留 4/12）

| 测试                                                            | 类  | 守的性质                      |
| --------------------------------------------------------------- | --- | ----------------------------- |
| decodes the contract's example listing verbatim                 | ①   | workspace_list 契约例逐字解码 |
| accepts a full, truncated page of 500 entries                   | ④   | 500 条整页/截断页容量         |
| whitelists every kind the contract defines, both families       | ③   | 类型化拒绝全 kind 白名单      |
| opens only on the advertised feature and fails closed otherwise | ③   | 能力门控 fail-closed          |

### tests/workspace.test.ts（留 4/9）

| 测试                                                              | 类  | 守的性质                    |
| ----------------------------------------------------------------- | --- | --------------------------- |
| decodes pre-session capabilities and every launch decision        | ①   | 启动决策全解码              |
| rejects ambiguous or unbounded launch profile identities          | ③   | 启动 profile 身份有界       |
| decodes session rows and file handles without exposing host paths | ③   | 主机路径不暴露              |
| decodes live token cost and context-window updates                | ①   | 令牌成本/上下文窗口更新解码 |

### src/btw.test.ts（留 3/8）

| 测试                                                                                            | 类  | 守的性质                 |
| ----------------------------------------------------------------------------------------------- | --- | ------------------------ |
| uses exactly the captured full Session and trimmed question, without a turn or profile override | ①   | btw 线协议捕获 scope     |
| fails closed without its own method, even when ordinary turn/start exists                       | ③   | 无自身方法即 fail-closed |
| does not reinterpret a wrong-Session receipt as a successful answer                             | ③   | 错会话回执不冒答         |

### src/external-driver-refusal.test.ts（留 4/13）

| 测试                                                                          | 类  | 守的性质                                  |
| ----------------------------------------------------------------------------- | --- | ----------------------------------------- |
| keeps a NON-allowlisted kind on a real protocol error as the scrubbed failure | ④   | 非白名单 kind 保持脱敏失败                |
| rejects a duck-typed lookalike that fails the identity check                  | ③   | 鸭子类型拒绝                              |
| throws for an unadvertised method and sends ZERO frames                       | ③   | 零帧离线门控                              |
| rejects an in-flight driver read on socket close and ignores the late reply   | ④   | 中途关闭拒绝 + 迟到应答忽略（真传输竞态） |

### src/steer.test.ts（留 3/6）

| 测试                                                                    | 类  | 守的性质                          |
| ----------------------------------------------------------------------- | --- | --------------------------------- |
| requires both native method and lossless return feature                 | ③   | steering 双重门控                 |
| sends the exact native kind-tagged input with a captured full Session   | ①   | steering 线协议                   |
| accepts the server-minted fallback UUID without inventing another start | ④   | 服务器铸造 fallback UUID 不再自起 |

### tests/cron.test.ts（留 2/6）

| 测试                                                     | 类  | 守的性质                         |
| -------------------------------------------------------- | --- | -------------------------------- |
| creates At, Every and Cron jobs with exact session scope | ①   | cron 创建线协议 + 精确会话 scope |
| fails closed without AUX                                 | ③   | 无 AUX 门控 fail-closed          |

### tests/execution-environment.test.ts（留 2/4）

| 测试                                                              | 类  | 守的性质                   |
| ----------------------------------------------------------------- | --- | -------------------------- |
| preserves a complete probe without guessing missing tools         | ④   | 完整探针保留，缺失工具不猜 |
| rejects malformed tool states instead of presenting them as facts | ③/④ | 畸形工具状态不当事实呈现   |

### tests/memory.test.ts（留 3/6）

| 测试                                                               | 类  | 守的性质                   |
| ------------------------------------------------------------------ | --- | -------------------------- |
| decodes overview, entity, search, and load projections             | ①   | memory 投影解码主链        |
| rejects wrong entity ids and missing AUX before calling the server | ③   | 上线前 id/AUX 校验         |
| sends the selected session on every read and mutation              | ③   | 每次读写携带选中会话 scope |

### tests/session-file-read.test.ts（留 2/2）

| 测试                                       | 类  | 守的性质          |
| ------------------------------------------ | --- | ----------------- |
| accepts a valid base64 chunk               | ④   | files/read 正例帧 |
| rejects wrong encoding and invalid offsets | ④   | 编码/偏移边界拒绝 |

### tests/session-files.test.ts（留 4/5）

| 测试                                                                    | 类  | 守的性质                   |
| ----------------------------------------------------------------------- | --- | -------------------------- |
| sends the tree params and returns one folder's page                     | ①   | 文件树分页线协议（T-0417） |
| reports an older Core's legacy flat listing as unsupported              | ④   | 旧 Core 扁平列表回退信号   |
| rejects malformed entries and workspace escapes instead of showing them | ③   | 工作区逃逸拒绝             |
| passes the keyset cursor through and reports the end of the list        | ④   | 键集游标透传与终止报告     |

### tests/skill-actions.test.ts（留 3/6）

| 测试                                                        | 类  | 守的性质                         |
| ----------------------------------------------------------- | --- | -------------------------------- |
| opts into both action feature families                      | ③   | 双 action feature 族 opt-in 门控 |
| lists trusted actions and returns background jobs           | ①   | 受信动作列表 + 后台任务回执      |
| fails closed on wrong scope and missing negotiated features | ③   | 错 scope/缺 feature fail-closed  |

### tests/usage.test.ts（留 3/8）

| 测试                                                                       | 类  | 守的性质                                 |
| -------------------------------------------------------------------------- | --- | ---------------------------------------- |
| parses what a real Core returns, keeping the server's own groupings        | ①/⑤ | #1376 真实 Core 回执解析，保留服务器分组 |
| sends the token only as a header, with the exact routes and RFC 3339 range | ③   | 令牌只走 header + 精确路由               |
| classifies failures without projecting response bodies                     | ③   | 失败分类不投影响应体                     |

## 执行备注（T-0503）

- 删除时连同对应 fixture（`tests/fixtures/`
  中仅被删测试引用的）一起清；`tests/fixtures/ui-protocol-v1.json`
  等多文件共享 fixture 按剩余引用保留。
- 保留项若同链可合并（如 autonomy 的 gating 族、external-driver 的门控族），按链合并但不删守卫。
- 删后跑 `python3 wake/test-lines.py`
  回填「基线与预计」实测数字；注意 #410 起 CI 对净增测试行亮红灯，T-0503 纯删不受影响。
- 注意 T-0500（e2e/TESTS-KEPT.md）与本清单独立，分别执行。
