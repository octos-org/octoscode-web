# Codex 0.10 主题、布局与跨浏览器验证

审计对象：`f6065a5d532353e6437e60445545d7403e787e41`。使用本地生产构建与独立协议 fixture；实际部署 checkout 同为该 revision。无产品源码修改。

## 主题：暗色成立，亮色未完全成立

6 种 OS/手动模式组合实际连接、发送 fixture 回复、打开 Settings，并采集计算后的 CSS
token 和 axe 结果。

| 对比                                | token 差异 | 结论                                                   |
| ----------------------------------- | ---------: | ------------------------------------------------------ |
| OS dark + System / OS light + Dark  |          0 | 手动暗色与系统暗色一致                                 |
| OS light + System / OS dark + Light |         42 | 手动亮色使用了另一套值，未镜像默认亮色                 |
| OS light + Light / OS dark + Light  |          0 | 手动亮色能覆盖 OS，但覆盖后的调色板不同于 System light |

42 为计算后的 custom
property 差异数，包含解析后的 Shiki 引用值，并非 42 个独立源码声明遗漏。

`theme.css:202` 开始的 manual light 块把默认 `#fff` 背景改为 `#fafafa`、主色
`#3564c6` 改为 `#3b82f6`、secondary/tertiary 等也换值。该差异不只影响外观：

- 回复链接：**3.52:1**，低于普通文字 4.5:1。
- 活跃会话时间：**4.16:1**。
- Settings 多处说明文字：**4.43:1**；Forget server：**4.42:1**。

System light、System dark、manual
dark 的相同场景未出现上述 color-contrast 违规。所有场景还报告了 textarea 的
`role=combobox` minor
best-practice 规则，这与本次颜色差异无关，不计为新的主题回归。

已通过：实际点击 System → Dark → Light →
System、刷新保存 Dark、清除手动覆盖后动态跟随 OS、桌面无横向溢出。

## 主题存储错误会扩大为整个应用失败

`App.tsx:198-212` 新增的 localStorage `getItem`、`setItem`、`removeItem`
没有异常处理。本轮分别注入 SecurityError /
QuotaExceededError，仅令主题偏好键的读写失败：三者均触发 GlobalBoundary 的
**Client view unavailable**，连接/当前界面不再可用。

这是有条件的 P2 健壮性回归，复现来自故障注入，不能声称普通浏览器默认就会触发。主题偏好保存失败不应升级为应用整体失败；SurfaceBoundary 无法隔离位于 App 根部的异常。

## 行宽：65ch 的修改未成为最终样式

`app/styles.css:1090` 定义 65ch；`Timeline.module.css:27`
仍定义 68ch，后加载且同等 specificity 的模块样式覆盖前者。

1440×1000 生产构建的 `.entry-assistant .entry-content` 实测
`max-width: 605.094px`，对应当前字体下约
**68ch**。正文已有限宽，但不能验收为 briefing 所述的 65ch。此项为 P3 规格偏差。

## Disclosure 动画与 fallback

同一 production build、相同 canonical reasoning/tool
fixture、键盘 Enter 切换、移动宽度 390px：

| 引擎                   | interpolate-size | 展开/收起实测                           | 键盘 / 移动溢出 |
| ---------------------- | ---------------- | --------------------------------------- | --------------- |
| Chromium 153.0.8010.12 | 支持             | 44↔364px，约 180ms 内 12 个不同高度采样 | 通过 / 无       |
| Firefox 155.0          | 不支持           | 原生即时 44↔364px                       | 通过 / 无       |
| WebKit 26.6            | 不支持           | 原生即时 44↔364px                       | 通过 / 无       |

Chromium 的 reduced-motion 模式为即时变化；Firefox/WebKit 原生 fallback 可读、可操作。可验收为“跨三引擎可用，动画渐进增强”，不能写成所有浏览器拥有相同高度动画。本轮 WebKit 是 Linux 自动化引擎，不等价于实机 iOS
Safari 全面测试。

## CLS 不能替代慢加载外观验收

人为把 Settings
chunk 的响应推迟至少 1200ms，超出用户输入的 500ms 排除窗口，读取 loading 与 loaded 的实际 bounding
box：

| 视口      | loading              | loaded             | 本场景 CLS |
| --------- | -------------------- | ------------------ | ---------: |
| 1440×1000 | 440×307，x500/y346.5 | 800×800，x320/y100 |          0 |
| 390×844   | 366×307，x12/y268.5  | 366×820，x12/y12   |          0 |

这次测量没有复现 briefing 的 0.0069–0.0257；不同页面和操作序列不应直接混为同一实验。这里 loading
dialog 被另一个组件替换，肉眼可见的大幅换尺寸不必产生计入 CLS 的“同一已有元素位移”。

Google 的 [CLS 定义](https://web.dev/articles/cls)
明确区分已有元素位置变化、元素新增与尺寸变化，并用最大 session
window 而非全程简单相加。0.1 是有用的体验指标，不能单凭几次实验室采样低于它就排除用户可见的加载跳变，更不能代替真实用户第 75 百分位判断。

本轮按最大 session window 计算 CLS，并保留 `hadRecentInput`
的所有原始 entries。固定版本补测中，Timeline 的 DeferredSurface 在桌面为 184→554px、手机为 184→629px，两个场景 CLS 同样为 0；因此占位高度与成品不匹配仍存在。Trajectory 的记录采用外部滚动容器作为 loaded 参照，不能把该容器尺寸当作实际内容高度，本轮不据此声称测得其内容跳变。原始数据见
`deferred-layout-results.json`。

## 证据

原始脚本、JSON 与截图在 `/tmp/octos-codex010/`：

- `theme-cls.mjs` / `theme-results.json`：6 模式 token、axe。
- `width-theme-cycle.mjs` /
  `width-cycle-results.json`：最终行宽、点击循环、刷新、OS 切换。
- `theme-storage.mjs` / `theme-storage-results.json`：三个存储 API 故障。
- `cls-browsers.mjs` / `cls-browsers-results.json`：慢加载 bounding box、CLS
  entries、三引擎逐帧高度采样。
- `settings-dark-light.png`、`loading-settings-{1440,390}.png`、`loaded-settings-{1440,390}.png`、`details-*-mobile.png`。

性能流程参考 web-perf skill；环境无 Chrome DevTools
MCP，实际使用 Playwright、PerformanceObserver 与浏览器计算样式，并未声称运行 Lighthouse 或获得真实用户 Web
Vitals 数据。

## 审计期间的并行变更

06:44 左右共享工作区出现其他工作对 Settings
fallback 的修改，并重建了共享 dist；随后提交为
`7743a69`。主审计没有修改或回退这些文件。上述主题/行宽/Settings 测量在该变更前完成；之后切换到
`/tmp/octos-codex010-pinned` 的固定 `f6065a5`
构建，完成剩余 DeferredSurface 和整套检查。此报告不能用来宣称 `7743a69`
的新 loading 占位仍保持原 440×307，也不把他人的修复计为本次实施。

对新提交另建 `/tmp/octos-codex010-followup` 并构建，仅复测 Settings 延迟路径：

| 7743a69 视口 | 新 loading | loaded  | CLS |
| ------------ | ---------- | ------- | --: |
| 1440×1000    | 440×667    | 800×800 |   0 |
| 390×844      | 366×667    | 366×820 |   0 |

高度差确已改善；桌面宽度仍受 `SurfaceBoundary.module.css`
的 440px 限制，不能验收为占位与成品完全同尺寸。记录在
`followup-cls-results.json`，并未对新提交重复整套产品验收。
