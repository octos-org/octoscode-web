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

## 两种模式

侧栏顶部的“工作模式”可以在**编码**和**对话**之间切换（手机上在抽屉里）：

- **编码**：选择服务器上的文件夹，新建会话，在里面工作；同一个文件夹可以有多个会话。权限和联网设置在输入框旁边，以服务器确认的为准；需要批准的操作会先问你。会话面板有概览、文件、改动、产物四个标签。需要 Octos
  v2.0.3 或更新。
- **对话**：做周报、资料整理这类不需要选文件夹的事。每个对话由服务器分配一个只属于它的文件夹。新对话只读、禁止联网；要存文件时点“允许生成产物”，文件出现在“产物”里，可以预览和下载，随时可以点“关闭生成产物”。需要 Octos
  v2.1.0 或更新。

两种模式共用首页模板、技能（按审查结果安装）、连接器、定时任务、专家团和记忆；这些功能只在服务器支持时出现。断线后从服务器恢复会话，不会悄悄重发；手机上可用，也可以安装成桌面应用（PWA）。

从 octoscode-web
1.0 起两种模式默认都打开。**1.0 还没有发布**：在那之前，v0.22 及更早的版本只有编码模式；main 上的构建也只显示编码模式，除非测试人员在自己的浏览器里打开对话预览。开法和关法见[使用对话模式](docs/getting-started.md#use-chat-mode)（英文）。

- [产品范围](docs/product.md#code-and-chat-modes)（英文）：对话模式做什么、怎样和编码隔开。
- [1.0 发布说明草稿](docs/release-notes-1.0-draft.md) 和
  [1.0 flag演练清单](docs/release-1.0-flag-drill.md)。

## 快速开始

在一个空的 home 目录里，Linux 或 Mac 上按下面五步做。令牌随便取一个字符串，所有地方用同一个。

需要：

- Git、curl，Node.js 22 或更新。
- pnpm 11.5.2。Node.js 22 或 24 上运行 `corepack enable`
  即可；报权限错误说明 Node.js 是给所有用户装的，用 `sudo`
  运行，或改用 nvm 这类装在自己目录下的 Node.js。Node.js
  25 起不再自带 Corepack，改为运行 `npm install -g pnpm@11.5.2`。
- Octos：编码模式需要 v2.0.3 或更新，对话模式需要 v2.1.0 或更新。第 1 步会装好。

**1. 安装 Octos 服务器。** 从
[Octos 发布页](https://github.com/octos-org/octos/releases)下载适合你电脑的包，校验后解压到
`~/.octos/bin`：

```sh
VERSION=v2.1.0
ASSET=octos-bundle-x86_64-unknown-linux-gnu.tar.gz
mkdir -p ~/.octos/bin
cd "$(mktemp -d)"
curl -fLO "https://github.com/octos-org/octos/releases/download/$VERSION/$ASSET"
curl -fLO "https://github.com/octos-org/octos/releases/download/$VERSION/$ASSET.sha256"
sha256sum -c "$ASSET.sha256"
tar -xzf "$ASSET" -C ~/.octos/bin
~/.octos/bin/octos --version
```

Linux ARM64 用
`ASSET=octos-bundle-aarch64-unknown-linux-gnu.tar.gz`。Apple 芯片的 Mac 用
`ASSET=octos-bundle-aarch64-apple-darwin.tar.gz`，校验改用
`shasum -a 256 -c "$ASSET.sha256"`。Windows x64 的包是
`octos-bundle-x86_64-pc-windows-msvc.zip`，这里的命令是给 Linux 和 macOS 的终端写的。v2.1.0 是第一个支持对话模式的 Octos 版本；它发布之前，用
`VERSION=v2.0.3` 可以先用编码模式。`~/.octos/bin` **不会**加进
`PATH`，所以下面都写全路径。

[Octoscode 终端](https://github.com/octos-org/octoscode)第一次运行时也会往
`~/.octos/bin` 装一个服务器，但装的是那个终端版本对应的 Octos。用
`~/.octos/bin/octos --version` 看版本，比你需要的旧就按上面装。

**2. 启动服务器：**

```sh
export OCTOS_AUTH_TOKEN=my-local-token
~/.octos/bin/octos serve --host 127.0.0.1 --port 50080 --solo
```

服务器从 `OCTOS_AUTH_TOKEN` 读令牌。不要再加
`--auth-token`：那样令牌会出现在进程列表里，服务器也会警告。`--solo`
让本应用在第一次使用时创建你的配置档案；不加的话，新服务器会提示“此服务器不支持从网页完成配置”。服务器的数据放在
`~/.octos`。

**3. 下载并启动本应用**（另开一个终端）：

```sh
git clone --branch v1.0.0 https://github.com/octos-org/octoscode-web.git
cd octoscode-web
pnpm install --frozen-lockfile
pnpm build
OCTOSCODE_DEV_PROXY_TARGET=http://127.0.0.1:50080 \
OCTOSCODE_DEV_PROXY_ORIGIN=http://127.0.0.1:50080 \
pnpm --filter @octos-org/octoscode-web exec vite preview --host 127.0.0.1
```

`--branch`
选发布版本，[发布页](https://github.com/octos-org/octoscode-web/releases)列出了所有版本；`main`
是还没发布的开发版。1.0 发布之前用
`--branch v0.22.0`，它只有编码模式。每个发布还带一个已经构建好的压缩包
`octoscode-web-<tag>.tar.gz`，用于放在网页服务器后面部署，见[部署](docs/deployment.md)（英文）。

两个 `OCTOSCODE_DEV_PROXY_*`
变量都要带：它们让浏览器只连本应用自己的地址，再由本应用转发给服务器。不带的话，服务器默认只信任它自己的地址，会拒绝浏览器，页面报连接失败，看起来像服务器或令牌有问题，其实都没问题。

**4. 打开
<http://127.0.0.1:4173>**（第 3 步打印的地址）。“服务器地址”保持不变，在“访问令牌”里填令牌，点“连接”。在“添加工作区”里填一个项目文件夹的完整路径，或点“浏览…”选择，然后点“开始会话”。第一次会打开“设置你的编程助手”：

1. **第 1/2 步 · 模型服务**：选提供商和模型，点“继续”。“高级”不用打开：里面是配置档案的 ID，不改就是
   `coding`。
2. **第 2/2 步 · 连接**：贴上这个提供商的 API 密钥，点“测试、保存并打开”。保存前会先用这个密钥测试；密钥由 Octos 保存，浏览器不保存。

之后会打开对话。用 Kimi 编程套餐见
[Kimi](docs/getting-started.md#kimi)（英文）。

**5. 也可以同时接上终端（可选）：**

```sh
OCTOS_AUTH_TOKEN=my-local-token octoscode \
  --endpoint ws://127.0.0.1:50080/api/ui-protocol/ws --profile-id coding
```

如果第 4 步改过配置档案 ID，用你改的那个。

常见报错、配对链接、升级和回退见 [README](README.md#run-locally)
和[快速开始](docs/getting-started.md)（英文）。

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
