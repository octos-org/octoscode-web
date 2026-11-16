<div align="center">

# octoscode-web

**浏览器里的 Octoscode。**

[快速开始](docs/getting-started.md) · [文档](docs/README.md) ·
[发布版本](https://github.com/octos-org/octoscode-web/releases) ·
[English](README.md)

</div>

octoscode-web 是 Octos 的网页客户端。连上你的 Octos 服务器，让 Octos 在服务器上的文件夹里写代码、改文件、整理报告和表格，结果以可以检查的文件交回来。它和终端里的
[Octoscode](https://github.com/octos-org/octoscode)
用同一台服务器上的会话；网页本身不运行智能体、工具或沙箱，也不保存会话。

文档大多是英文，本页只介绍要点。界面可以切换成中文：在输入框里输入
`/lang zh`，或在“浏览器偏好”里选择语言。

## 编码模式：现在可用

现在发布的版本只有编码模式，所有用户看到的都是它：

- 选择服务器上的文件夹，新建会话，在里面工作；同一个文件夹可以有多个会话。
- 权限和联网设置在输入框旁边，以服务器确认的为准；需要批准的操作会先问你。
- 会话面板有概览、文件、改动、产物四个标签。改动可以看差异；产物可以预览和下载（Markdown、图片、PDF、CSV 等，Office 文件只提供下载）。
- 首页模板、技能（按审查结果安装）、连接器、定时任务、专家团和记忆；这些功能只在服务器支持时出现。
- 断线后从服务器恢复会话，不会悄悄重发；手机上可用，也可以安装成桌面应用（PWA）。

## 对话模式：预览中，还没有开放

对话模式用来做周报、资料整理这类不需要选文件夹的事：每个对话由服务器分配一个只属于它的文件夹。新对话默认只读、禁止联网，要存文件时点“允许文件产出”，随时可以关闭。

**对话模式还没有对用户开放：**

- 它在一个按浏览器设置、默认关闭的预览开关后面，开关的默认值不会改。
- 它需要的内核能力（每个对话一个服务器分配的文件夹等）还没有发布；网页也还没有在连接时请求这些能力，所以现在打开开关，对话按钮也是不可用的。
- 它只在本仓库自带的协议夹具里走通过全流程。夹具里的文件是模拟的，不能当作真实服务器上可用的证明。
- 开放前还要通过权限安全复审，并在指定的体验环境里按演练清单打开、冒烟、关回。

对话模式开放时计划发布 octoscode-web 1.0，现在 1.0 还没有发布。细节见：

- [产品范围](docs/product.md#code-and-chat-modes)（英文）：对话模式做什么、开放前要满足什么。
- [1.0 发布说明草稿](docs/release-notes-1.0-draft.md) 和
  [1.0 flag演练清单](docs/release-1.0-flag-drill.md)。

## 快速开始

需要 Node.js 22+ 和 pnpm（`corepack enable` 会装好对应版本），以及一个 `octos`
可执行文件。先启动服务器，再启动本应用：

```sh
export OCTOS_AUTH_TOKEN=my-local-token
~/.octos/bin/octos serve --host 127.0.0.1 --port 50080 \
  --auth-token "$OCTOS_AUTH_TOKEN" --solo
```

```sh
pnpm install --frozen-lockfile
OCTOSCODE_DEV_PROXY_TARGET=http://127.0.0.1:50080 \
OCTOSCODE_DEV_PROXY_ORIGIN=http://127.0.0.1:50080 \
pnpm dev
```

打开第二步打印的地址，填入同一个令牌后连接。完整步骤、常见报错和不连服务器的开发方式见
[README](README.md#run-locally) 和[快速开始](docs/getting-started.md)。

## 文档

| 文档                                | 用途                             |
| ----------------------------------- | -------------------------------- |
| [快速开始](docs/getting-started.md) | 运行应用、连接服务器             |
| [产品范围](docs/product.md)         | 功能、边界和两种模式的状态       |
| [排障](docs/troubleshooting.md)     | 连接、恢复、命令和对话按钮不可用 |
| [部署](docs/deployment.md)          | 部署和回滚                       |
| [发布](docs/releasing.md)           | 发布不可变的版本包               |
| [中文术语表](docs/glossary-zh.md)   | 界面中文用词                     |
| [更新记录](CHANGELOG.md)            | 每个版本给用户和运维的变化       |

## 许可

Apache-2.0。复制或改编的第三方内容记在
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，生产依赖的许可记在
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
