# DeepSeek Harness Desktop

[English](README.md) | 中文

[![Desktop test](https://github.com/Dr1empty/deepseek-harness-desktop/actions/workflows/desktop-test.yml/badge.svg)](https://github.com/Dr1empty/deepseek-harness-desktop/actions/workflows/desktop-test.yml)
[![Release](https://img.shields.io/github/v/release/Dr1empty/deepseek-harness-desktop?include_prereleases&label=Desktop)](https://github.com/Dr1empty/deepseek-harness-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078d4)](#系统要求)

DeepSeek Harness Desktop 是集成在 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) Fork 中的非官方 Windows 桌面发行版。它保留上游 Harness 的 Web UI、Agent、会话和插件体系，在此基础上补齐一键安装、本地服务生命周期、内核更新、用量与余额、二维码充值、单实例窗口和可复现发布等桌面能力。

本项目不是 DeepSeek 官方产品，也不代表 DeepSeek 的维护或背书。

## 下载

| 平台 | 安装包 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | [DeepSeek Harness Desktop 1.1.4](https://github.com/Dr1empty/deepseek-harness-desktop/releases/tag/v1.1.4-desktop) | NSIS Setup，内含 Node.js 和 Harness，不要求预装开发环境 |

安装包尚未进行商业代码签名，Windows 可能显示“未知发布者”。请从 Release 同时下载 `SHA256SUMS.txt`，或核对 1.1.4 Setup 的 SHA-256：

```text
E45CD34A4FF3B1A7D02844DDC797565013ACC3DB1E0E6B1451E52FBE5FACF670
```

## 为什么做这个 Desktop

上游 Harness 提供核心 Agent 平台和 Web 交互界面，但从源码或 CLI 运行时，Windows 用户仍需自行准备 Node.js、管理进程、记住端口、处理更新，并在浏览器与终端之间切换。

这个 Desktop 版本解决的是“如何把上游稳定地作为 Windows 应用运行”：

- 下载一个 Setup 即可安装，不要求用户配置 Node.js、npm 或 pnpm。
- 点击快捷方式自动启动 Harness，本地服务就绪后直接进入上游 Web UI。
- 关闭应用时回收后端进程；后端异常退出时展示最近日志，而不是留下黑色终端窗口。
- 把 Desktop 自有功能放进 Harness 设置界面，不额外制造一套与上游割裂的首页。
- 将内核更新、用量、余额和充值集中在同一个桌面窗口中。

## 相比上游增加了什么

| 能力 | 上游 Harness | 本 Desktop 的新增实现 |
| --- | --- | --- |
| Windows 分发 | 以 CLI/npm 包和 Web 应用为主 | NSIS Setup、桌面快捷方式、开始菜单入口和便携 Node.js 24 |
| 本地服务 | 用户通过 CLI 启动和停止 | Electron 主进程托管子进程、就绪检测、端口回退、退出清理和故障提示 |
| 窗口生命周期 | 浏览器标签页 | 单实例桌面窗口；重复点击只聚焦已有窗口 |
| 启动体验 | 取决于 CLI 与浏览器 | 本地启动页、后端与 Chromium 并行初始化、启动阶段计时 |
| 内核更新 | 通过包管理器手动处理 | 设置内检查 npm 新版、下载验证、失败保留旧版、成功后重启切换 |
| 用量与余额 | 不属于核心 Web UI 的 Desktop 功能 | 汇总本机会话 token，查询 DeepSeek 官方余额并提示余额不足 |
| 充值 | 跳转开放平台网页 | 设置内原生金额/支付方式界面，后台生成支付宝或微信官方付款二维码 |
| 发行验证 | 上游测试面向 Harness 本体 | Desktop 单元测试、真实 NSIS 构建、打包态冒烟测试、SHA-256 与 manifest |

这里所说的“新增”只指 Desktop 外壳和集成功能。模型调用、Agent 执行、会话格式、工具系统、官方 Web UI 与官方核心插件仍来自上游 Harness。

## 主要功能

### 一键安装与零环境启动

- 随安装包提供 Node.js `24.18.0` 和锁定的 `@deepseek-ai/dsh@0.1.1-rc.2`。
- 后端使用隐藏子进程运行，不弹出额外 CMD/PowerShell 窗口。
- 固定首选端口 `64788`，使按 origin 保存的 Web 数据能够跨重启复用。
- 如果首选端口被占用，自动回退到操作系统分配的本地端口。
- 服务只加载到 `127.0.0.1`，不会主动暴露为局域网服务。

### 单实例与可靠退出

- 同一 Desktop 发行版只允许一个主实例。
- 重复点击快捷方式时恢复、显示并聚焦已有窗口。
- 正常退出时同步清理 Harness 子进程树，减少残留端口和重复服务。
- 后端在就绪前失败时保留 stdout/stderr 尾部，显示更具体的启动错误。

### 启动性能优化

- Harness 后端与 Electron/Chromium 初始化并行进行。
- 支付会话延迟到用户首次使用充值功能时初始化。
- profile junction 兼容检查使用内核、依赖清单和目录状态指纹；只有内核或 profile 改变时才重新全量检查。
- 日志包含 ISO 时间和相对启动耗时，可区分窗口创建、后端就绪与页面加载阶段。
- 未启用 `NODE_COMPILE_CACHE`：在实际 Node 24 + Harness rc.2 基准中没有收益，反而略慢。

一次本机验证中，重复 profile 检查从约 `478 ms` 降至 `14–16 ms`。打包版无外加插件的冒烟测试在约 `3.69 s` 后端就绪、`4.32 s` 完成页面加载；实际时间会随磁盘、杀毒软件、内核版本和用户插件数量变化。

### 设置内的 Harness 内核更新

- 显示当前 Desktop 版本和 Harness 内核版本。
- 从 npm Registry 查询 `@deepseek-ai/dsh` 最新版本。
- 在用户数据目录安装新内核，完整版本准备成功后才切换指针。
- 下载或安装失败不会覆盖当前可用运行时。
- 更新完成后由 Desktop 重启，并自动选择已经验证的新内核。

> 更新按钮更新的是 Harness npm 内核，不是 Electron Desktop Setup。Desktop 外壳更新仍通过 GitHub Releases 发布。

### 用量、余额与低余额提醒

- 从本地会话事件中汇总今日、本月和累计请求/token。
- 统计输入、输出、缓存读取、缓存写入和推理 token。
- 对分叉会话进行请求去重，避免同一条 usage 被重复累计。
- 使用当前 DeepSeek 凭据查询官方余额，并显示余额是否可用。
- 余额不足时显示桌面提醒；刷新后余额恢复，旧警告会同步消失。
- 本地统计只覆盖仍保存在本机的会话，不等同于官方账单。

### 原生二维码充值界面

- 充值栏直接位于“设置 → 使用情况”，不是把完整充值网页嵌入应用。
- 支持选择支付宝或微信支付、输入人民币金额并生成官方付款二维码。
- 二维码在本地从 DeepSeek 官方订单 URL 生成，不经过第三方二维码服务。
- 付款状态在后台轮询，支付成功后刷新余额。
- 只有确实需要重新认证时才显示受控登录窗口；充值网页跳转会保持隐藏。

支付订单、余额与价格以 DeepSeek 开放平台实际返回为准。本项目不代收款、不保存银行卡信息，也不提供第三方充值渠道。

### 图片与视觉模型说明

- 首次启动默认选择实验性目录项 `deepseek-v4-flash-vision-exp`。
- `deepseek-v4-flash` 和 `deepseek-v4-pro` 能否处理图片，取决于当前 Harness 内核的模型目录、附件管线或视觉工具路由。
- 模型目录显示图片能力，不等同于证明某个远端模型 API 原生接收图片。
- 本仓库的分发 Setup 不内置 Vision Router；用户可自行安装兼容插件或配置视觉供应商。

## 插件边界

Desktop 1.1.4 不预装任何第三方外加插件。以下组件不会进入 Git 仓库、Setup 或独立 Desktop profile：

- `dsh-client-liang-intensity-skin`
- `@dsh-external/dsh-super-injector` / routing-suite
- `dsh-vision-router`
- iMessage 集成
- 质谱接口

Harness 自身采用插件架构，其正常运行所需的官方核心 bundle 不属于这里所说的“外加插件”。开发者本机可以在自己的 DSH profile 中安装插件；这些本机配置与公开分发内容相互独立。

## 运行架构

```text
Windows 快捷方式
        │
        ▼
Electron 主进程 ── 单实例锁 / 日志 / 更新 / 用量 / 支付
        │
        ├── 启动页与安全 BrowserWindow
        │
        └── 便携 Node.js
              │
              ▼
       @deepseek-ai/dsh web
              │
              ├── 上游 Harness Web UI
              ├── 上游 Agent / Session / Tools
              └── 用户自己的 DSH profile 与凭据
```

主窗口启用 `contextIsolation`、Renderer sandbox，并关闭 Renderer 的 Node.js 集成。后端子进程只接收运行所需环境变量；Desktop 不把完整凭据列表发送给渲染器。

## 数据目录与联网行为

| 数据 | 位置/行为 |
| --- | --- |
| Desktop 窗口和内核指针 | Electron 用户数据目录 |
| 分发版 DSH 设置与会话 | Desktop 独立 DSH Home |
| 可更新 Harness 运行时 | Desktop 用户数据目录下的 `runtime/` |
| 启动日志 | `%TEMP%\dsh-desktop.log` |
| API Key 与会话 | 仅保存在本机 Harness/凭据存储中 |

模型请求与余额查询访问 DeepSeek 服务；内核检查访问 npm Registry；用户主动登录或充值时访问 DeepSeek 开放平台；Desktop Setup 下载来自 GitHub Releases。详细说明见 [PRIVACY.md](apps/desktop/PRIVACY.md)。

## 系统要求

- Windows 10 或 Windows 11，x64。
- 能够访问所配置模型供应商的网络。
- 至少约 600 MB 可用磁盘空间用于安装、运行时更新和缓存。
- 不要求系统预装 Node.js、npm、pnpm 或 Harness CLI。

当前不提供 macOS、Linux 或 Windows ARM64 安装包。

## 开发

Desktop 源码位于 Fork 的 `apps/desktop`：

```powershell
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop\apps\desktop
npm ci
npm test
npm start
```

在 Fork 中开发时，Desktop 自动使用仓库根目录的 Harness 源码。独立检出 `apps/desktop` 时，也可通过 `DSH_SOURCE_ROOT` 指定 Harness 源码目录。

### 构建 Windows Setup

```powershell
npm run release:desktop
```

构建会执行：

1. 下载并校验 Node.js 24.18.0 Windows x64 运行时；
2. 按锁文件安装 Harness 0.1.1-rc.2；
3. 验证发行配置未包含第三方外加插件；
4. 构建 `win-unpacked` 和 NSIS Setup；
5. 生成 `SHA256SUMS.txt` 与 `release-manifest.json`。

生成目录均被 Git 忽略：

- `build/desktop-harness/`
- `vendor/node/`
- `dist-desktop/`
- `dist-desktop-installer/`

## 项目结构

```text
src/main.js                     Electron 生命周期、窗口和 IPC
src/backend.js                  Harness 子进程、端口、就绪与链接维护
src/preload.js                  设置内更新、用量和充值界面
src/updater.js                  Harness npm 内核的验证安装与切换
src/usage.js                    本地 usage 聚合和 DeepSeek 余额查询
src/payment.js                  官方订单、受控登录与二维码支付
tests/                          Desktop 单元测试
build/prepare-desktop.cjs       可复现的运行时准备
build/make-release-metadata.cjs Release 哈希与 manifest
electron-builder-desktop*.yml   Windows 目录包和 NSIS 配置
```

## 验证状态

Desktop 1.1.4 已完成：

- 21 项 Node 单元测试；
- Windows x64 真实 NSIS Setup 构建；
- 打包态后端启动与页面加载冒烟测试；
- 本机带四个外部插件的 profile 启动回归；
- GitHub Actions 从干净环境重新安装依赖、运行测试、构建 Setup 并上传 Artifact；
- Release Setup、blockmap、SHA-256 和机器可读 manifest 校验。

## 当前限制

- Desktop Setup 尚未进行商业代码签名。
- Electron 外壳不会自动更新自身，需要从 GitHub Release 安装新版 Setup。
- 本地用量统计可能因会话删除、迁移或旧记录不完整而低于官方账单。
- DeepSeek 开放平台登录、余额和支付接口变化可能影响充值功能。
- 第三方插件兼容性由插件作者及用户 profile 决定，不属于无插件分发版保证范围。

## 与上游的关系

- 上游项目：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 本 Fork：[Dr1empty/deepseek-harness-desktop](https://github.com/Dr1empty/deepseek-harness-desktop)
- Desktop 源码：[apps/desktop](https://github.com/Dr1empty/deepseek-harness-desktop/tree/master/apps/desktop)
- Desktop Release：[v1.1.4-desktop](https://github.com/Dr1empty/deepseek-harness-desktop/releases/tag/v1.1.4-desktop)

上游 Harness 的代码和商标遵循其自身许可与政策；Desktop 自有代码按 [MIT License](apps/desktop/LICENSE) 发布。第三方组件声明见 [THIRD_PARTY_NOTICES.md](apps/desktop/THIRD_PARTY_NOTICES.md)，版本变化见 [CHANGELOG.md](apps/desktop/CHANGELOG.md)。
