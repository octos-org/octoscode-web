# Codex 0.10 独立验证

> 这是修复前的独立审计快照。随后用户授权的分类、修复及最终复核见[修复报告](2026-09-15-codex010-release-readiness.md)。

审计入口为
`docs/CODEX-010-BRIEFING.md`。本轮只验证，没有修改产品源码、实施修复或提交 PR。

结论：近期改进多数成立，但不能整体验收为“声明全部正确”。如果发布前只增加一个修复，我选择
**修复已完成会话在 hydrate 后的工具身份关联，使刷新、重新打开会话前后的工具数量和顺序一致**。它在真实 Core 的普通只读任务中稳定复现，并已证明存在无需 Core 新字段的保守前端修复路径。

## 范围与版本

- 初始仓库、真实部署、固定审计基线均为
  `f6065a5d532353e6437e60445545d7403e787e41`（briefing
  #92）。Core 契约以仓库固定 rc.9 revision 为准。
- 主 agent 保留此前上下文，因此没有把自己的操作称为“零上下文”。独立浏览器 agent 使用
  **不继承历史对话**
  的会话，先使用产品，30 分钟结束前不读旧审计报告、briefing 或功能实现源码。
- 另一个独立 agent 核对 fold/sweep 与 SurfaceBoundary；主 agent 完成 wire 输入边界、主题、CLS、三引擎验证与证据复核。
- 约 06:44 UTC 共享工作区出现其他工作的 Settings 占位修改，随后提交为
  `7743a69`。主 agent 保留了该工作，转到 `/tmp/octos-codex010-pinned`
  的固定提交完成剩余检查。`7743a69`
  不改变本报告的主题、解码和工具合并发现；它的 loading 修改不冒充本次实施，也不与基线加载尺寸混用。新提交的独立补测为桌面 loading
  440×667→成品800×800：高度差改善，宽度仍未匹配。

## 四项请求的结果

### 1. 零上下文使用 30 分钟

独立体验为 2026-09-15 **06:31:52.508→07:01:54.701
UTC，共 30 分 02.193 秒**，覆盖 2 个真实会话、12 个只读轮次（11 个完成、1 个主动停止）。记录了 157 个成功操作批次、至少 221 次明确 UI 调用和 43 张截图。详细操作及证据见
[浏览器记录](2026-09-15-codex010-fresh-browser.md)。体验覆盖连接、发送、reasoning/tool/回答阅读、主题、完成后刷新、移动端、键盘、草稿、队列、取消以及会话导航。

真实会话只执行只读任务。第一次运行 pwd 与 git
status 后，live 有两张 bash 卡；刷新后出现两张 Tool
output 和末尾两张 bash，折叠条目从 4 变成 6。第二次刷新同样复现；后续新的真实 read_file 会话在切换会话后重新打开也复现同样的输出/调用拆分。工具没有被证明重新执行，错误在历史显示与关联。

### 2. fold/sweep 与错误隔离

[详细审计](2026-09-15-codex010-fold-boundary.md)
包含逐条代码位置、Core 契约、最小纯函数反例与浏览器故障注入。

成立：reasoning 按工具边界分段、终态覆盖所有匹配分段、跨 turn 隔离、幂等终态、迟到文本防护、活动提示；Settings/Review/嵌套 GeneralSettingsContent/CodeBlock 加载失败不会卸载 session
owner，草稿和 Stop 保留。

限制：CodeBlock 失败由 Conversation 整体边界接住，并非每条消息单独隔离；失败 lazy
import 仍需 reload 才能重试，这与现有错误页提示一致。

正常协议路径的遗漏有两类：普通工具 hydrate 未补 turn 归属；background
completion 未使用 message_id/media，导致 replay 重复正文、live 附件遗漏。普通工具刷新问题覆盖更广，作为唯一发布前优先项。

另在双浏览器同会话观察到旁观窗口“回答→用户追问”，发送窗口顺序正常。第二次真实捕获显示 Core 按 seq 先发 reasoning
1–17、assistant delta 18–22，再发 user_message 23、persisted 24、terminal
25。前端遵从了入站顺序；发送方的 optimistic
user 提前占位掩盖差异。该观察另记为 Core 用户消息迟发与旁观阅读顺序的交互边界，不认定为前端传输重排，也不并入下述唯一优先修复。

另须限定“纯函数”一词：整个 `foldNotification` 的 warning/无效帧分支仍调用
`Date.now()`；同毫秒 warning 可因 ID 相同被覆盖。主审计固定时钟探针确认这一 P3 边界，正常分段与 sweep 的通过结论不应扩展成整个 reducer 严格纯。

### 3. wire-decoders / projection 输入空间

[输入空间报告](2026-09-15-codex010-wire-inputs.md)
记录 600 项确定性断言与消费链复现。

外层数值/游标/身份校验符合当前行为，unknown
payload 扩展空间可保留。尚未补齐的是已知 payload 的内部字段校验：异常
`turn_terminal`
能提前结束队列却不产生 timeline 终态；非字符串工具名存在抛错路径。这些异常形状不是固定 Core 正常 serializer 的输出，归为防御性健壮性缺口，不与真实工具 hydrate 问题混为同一严重性。

### 4. 发布前只加一个修复

**补足 hydrated message 的 turn 身份关联。** 保留 `message.thread_id`，只在
`hydrate.turns[].thread_id → turn_id`
存在唯一对应时补全，再使用同 turn、唯一候选的合并约束。

真实脱敏响应验证：原函数得到 4 个工具条目；仅补入该唯一映射，得到 2 个，并保留原输出。缺映射、冲突映射或同 turn 重复输出时应保留信息，不能按正文盲删，也不能宣称 thread 等于 tool-call
identity。

验收应使用
**rc.9 实际不带 message.turn_id 的 hydrate 形状**，检查刷新前后工具数量、原始顺序、完整输出、同 turn 相同输出时的保守行为。现有成功测试人为提供了 turn_id，因此没有覆盖真实入口。

## 对 briefing 各项声明的核对

| 声明                           | 验证结论                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| reasoning 分段 / 终态 sweep    | 通过，包含多分段与跨 turn 反例验证                                                       |
| 流式自动 open、完成 collapse   | 文档过时；当前为读者控制，完成不强制关闭，这一行为通过                                   |
| tool 输出 500 char cap         | 文档过时；当前保留收到的完整正文并限制披露区域高度                                       |
| Deep diving 指示器             | 文案和派生实现已改为 Working/Thinking/Running/Preparing 等活动状态；功能通过             |
| 手动主题循环与持久化           | 正常 storage 下通过，包括动态 OS 切换                                                    |
| 手动暗色与系统暗色一致         | 通过，计算后的 token 差异为 0                                                            |
| 手动亮色与系统亮色一致         | 不成立：42 个计算值不同，实际出现 3.52:1 链接等对比度不足                                |
| SurfaceBoundary 隔离           | 核心承诺通过；另有根部 theme storage 异常导致整个应用错误页的条件性回归                  |
| 200 条历史展开 / copy 会话约束 | 既有浏览器回归验证覆盖，展开保留阅读锚点、晚到剪贴板结果不污染新上下文                   |
| 65ch 行宽                      | 未实际生效，被模块的 68ch 覆盖；已有有限行宽                                             |
| “No output yet” / 空态词汇清理 | 旧文案已移除，当前空工具输出有 Waiting/Finished 说明                                     |
| 折叠动画跨浏览器               | Chromium 动画通过；Firefox/WebKit 原生即时 fallback 可操作，reduced-motion 通过          |
| CLS 达标代表加载尺寸可接受     | 不能由该指标推出；基线慢 Settings 的 440×307→800×800 在本场景 CLS 为 0，仍有明显尺寸变化 |

主题、样式、存储故障、三引擎逐帧采样与 CLS 方法见
[主题和布局报告](2026-09-15-codex010-theme-layout.md)。CLS 定义依据
[web.dev](https://web.dev/articles/cls)，没有将实验室测量冒充真实用户第 75 百分位结果。

## 验证证据

- 固定基线
  `pnpm check`：466 项单元测试、格式、lint、类型、许可、策略、构建与部署检查。
- 固定基线完整浏览器回归 **97/97 通过**（5.1 分钟），LoAF 最长帧 120.8ms；日志
  `/tmp/octos-codex010/pinned-e2e-run.log`。
- 额外解码断言 600 项通过；额外模型验证 13 项中 10 通过、3 个期望断言失败，对应本报告确认的工具重复、后台重复、后台附件遗漏。
- 额外错误隔离浏览器验证 2 项通过。
- Chromium 153.0.8010.12、Firefox 155.0、WebKit
  26.6 的真实浏览器披露操作通过；Linux WebKit 不等同于完整实机 iOS 测试。

测试通过与新缺陷并存的原因已具体定位：部分成功 fixture 提供了真实 hydrate 没有的字段，主题自动化主要覆盖 OS 暗色，而外层 decoder 测试不等于内部 payload 验证。没有用“既有测试全部通过”代替上述独立复核。
