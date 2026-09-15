# Codex 0.10 协议输入验证

审计对象：`f6065a5d532353e6437e60445545d7403e787e41`。本轮仅验证，未修改产品源码。

主 agent 完成了 `wire-decoders.ts`、`projection.ts`
及 hydrate、durable-session、timeline、终态 consumer 的交叉核对。输入语义参照仓库固定的 Core
rc.9 contract，未把任意 JavaScript 对象都当成真实 JSON wire 输入。

## 已验证成立

- `isNonNegativeInteger`
  拒绝负数、小数、NaN、Infinity 和超过 JavaScript 安全整数上限的序号。接受 `0`
  与 `-0` 符合非负整数语义。Core 的 `u64`
  比 JS 范围更大，这里的拒绝是避免精度丢失的保守边界。
- 字符串、字符串数组、cursor 的 stream/seq 组合，以及 envelope 身份和序号字段，共执行
  **600 项断言**，均符合当前声明的外层校验行为。
- cursor 可在 parser 中缺省，实际 live 消费由 `DurableSessionProjection.observe`
  拒绝缺 cursor、游标换流、线程序号间隙；重复和恢复缓冲中的过期事件不再次 fold。parser 可解析缺 cursor 的旧 replay 形状，不等于 live 状态接受它。
- 未知 payload type 保留扩展空间，本轮不建议为所有未来事件建立拒绝名单。
- `hydrate.ts`
  已校验 message 的序号、字符串字段和 media 数组；未知的 threads/context 等仍是刻意保留的未类型化边界，不应宣称完整协议已验证。

## 尚未覆盖的已知 payload 语义

`projection.ts:13-22` 只要求 payload 有字符串 `type` 和 `data`
属性，没有验证各已知事件内部字段。这个选择要求 consumer 在改变状态之前继续校验，但当前各 consumer 的标准不一致。

### 异常终态会通过完整性门并结束队列

最小输入：正常 session/thread/turn/seq/cursor，payload 为
`{"type":"turn_terminal","data":null}`。

实测：

1. `parseProjectionEnvelope` 返回 envelope；`DurableSessionProjection.observe`
   返回 `apply` 并推进 cursor。
2. `terminalTurnId` 返回该 turn；`terminalTurnOutcome`
   返回 null；`foldNotification` 没有添加终态，原 reasoning 保持 running。
3. `use-octos-session.ts:1334-1340` 把缺失 outcome 当作 `failed` 调用
   `settleTurn`。

因此“足以变更队列生命周期”与“足以渲染终态”使用了不同的证据。缺 outcome 或未知 outcome 也不能直接当成已确认失败。这里应明确区分异常/不支持的数据与服务端确认的终态。

### 工具名缺少类型校验会令 fold 抛错

合法 JSON 形状但不符合已知 ToolStart 契约的
`name: {"toString":null}`，通过外层 parser 后进入 `String(data.name)`，实测抛出
`TypeError: Cannot convert object to primitive value`。这不是服务器正常工具名输入；它说明外层
`data: unknown` 尚未在 fold 前被收窄。

这两项属于 **P2 防御性健壮性缺口**：固定 Core 的 typed
serializer 正常情况下不会产生这类字段。它们不是对真实 Core 的攻击复现，也不作为比真实会话恢复重复更高的发布阻塞项。可保留未知事件扩展性，同时严格验证会改变生命周期的已知事件。

## 真实合法输入的遗漏

本轮在真实 Core 完成两次只读工具调用后刷新，出现持久化 Tool output 与 replay
bash 两套条目。此处并非异常输入：rc.9 的 hydrated tool message 无
`turn_id`，而前端合并要求
`entry.turnId === envelope.turn_id`。详细原始字段、纯函数反例与修复边界见
[fold/boundary 审计](2026-09-15-codex010-fold-boundary.md)。

如果只选择一个发布前修复，应优先解决这个正常输入下的工具历史关联，让同一轮会话在 live 与 hydrate 后保持一致；本节的异常 payload 加固可另行安排。

另一个真实合法时序应纳入后续消费测试：旁观窗口实收 reasoning seq1–17、assistant
delta18–22、user_message23、persisted24、terminal25。序号连续且解码有效；用户消息未必最先到达。发送窗口的 optimistic
user 令它看起来正常，旁观窗口则按到达顺序把回答放在提问之前。该边界不应被误判为 decoder 接受乱序包，详细来源见 fold/boundary 报告 F3 与
`observer-envelope-metadata.json`。

## 可复核证据与限制

- `/tmp/octos-codex010/wire-audit.mjs`：确定性边界矩阵与上述最小复现。
- `/tmp/octos-codex010/wire-results.json`：600 项断言、异常终态各消费阶段的结果与工具名异常。
- 原有 client 83 项、web
  383 项单元测试通过；这些通过不代表内部 payload 输入空间已穷尽。
- 稀疏数组、Proxy、getter 等非 JSON 输入不计为 wire 缺陷；未进行无界负载或耗尽资源测试。
