# DeepSeek Harness Desktop

DeepSeek Harness Desktop 是 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) Fork 中的非官方 Windows 桌面应用。它把 Web UI、Harness 后端和便携 Node 运行时装进一个可分发的 NSIS 安装包，不要求用户预装 Node.js 或 pnpm。桌面代码位于本 Fork 的 `apps/desktop`。

> 本项目不是 DeepSeek 官方产品，也不代表 DeepSeek 的维护或背书。

## 下载

从 [GitHub Releases](https://github.com/Dr1empty/deepseek-harness-desktop/releases/latest) 下载 `DeepSeek-Harness-Desktop-Setup-1.1.3.exe`。安装包尚未进行商业代码签名，Windows 可能显示“未知发布者”；可使用同一 Release 中的 `SHA256SUMS.txt` 验证文件。

## Desktop 发行版内容

- Harness 内核：`@deepseek-ai/dsh@0.1.1-rc.2`
- 单实例桌面窗口：重复点击快捷方式只激活已运行窗口
- 设置内的软件更新栏目：检查并更新 Harness 内核，失败时保留内置版本
- DeepSeek 用量、余额、低余额提醒和原生二维码充值界面
- 首次启动默认配置实验性视觉模型 `deepseek-v4-flash-vision-exp`
- `deepseek-v4-flash`、`deepseek-v4-pro` 的图片处理取决于当前 Harness 运行时的模型目录和工具路由；这不表示两个模型本身原生接收图片
- 独立用户数据和 DSH Home，不污染已有 Harness 配置

Desktop 版不预装任何第三方外加插件。Harness 内核自身采用插件架构，其正常运行所需的官方核心组件不属于这里所说的外加插件。发行版明确不包含：

- `dsh-client-liang-intensity-skin`
- `@dsh-external/dsh-super-injector`
- `dsh-vision-router`
- iMessage 集成
- 质谱接口

## 本地数据与联网行为

首次使用时，需要在应用中配置自己的 DeepSeek API Key。密钥和会话保存在本机 Desktop 独立数据目录，源码仓库和安装包都不包含用户凭据。首次运行会自动迁移旧发行版用户目录的数据，避免重命名后丢失配置。余额查询、模型请求、主动登录和支付订单会访问 DeepSeek 服务；Harness 更新会访问 npm Registry。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 开发

要求 Windows x64、Node.js 24 和 npm：

```powershell
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop
cd apps/desktop
npm ci
npm test
npm start
```

在 Fork 仓库中开发时，Desktop 自动使用仓库根目录的 Harness 源码；独立工作副本也可通过 `DSH_SOURCE_ROOT` 指定 Harness 源码目录。打包模式使用准备脚本生成的内置 npm 运行时。

GitHub 的 `Desktop test` 工作流会在 Windows runner 上执行单元测试并真实构建 NSIS Setup，避免只验证 JavaScript 而遗漏打包问题。

## 构建 Desktop Setup

```powershell
npm ci
npm run release:desktop
```

`release:desktop` 会自动完成：

1. 下载并校验 Node.js 24.18.0 Windows x64 运行时；
2. 按锁文件安装 Harness 0.1.1-rc.2；
3. 验证发行版未预装第三方外加插件；
4. 构建 `win-unpacked` 和 NSIS Setup；
5. 生成 `SHA256SUMS.txt` 与 `release-manifest.json`。

所有路径都相对于仓库解析，不依赖维护者电脑上的固定构建目录。生成内容放在以下被忽略目录中：

- `build/desktop-harness/`
- `vendor/node/`
- `dist-desktop/`
- `dist-desktop-installer/`

## 项目结构

```text
src/                         Electron 主进程、预加载、更新、用量和支付逻辑
tests/                       Node 单元测试
build/prepare-desktop.cjs    可复现 Desktop 构建依赖准备
build/make-release-metadata.cjs
                              发布哈希与清单生成
assets/                      图标与 Desktop 分发标识
electron-builder-desktop.yml
                              Desktop 目录构建配置
electron-builder-desktop-installer.yml
                              Desktop NSIS 安装包配置
```

## 发布文件

每个正式 Release 应至少包含：

- `DeepSeek-Harness-Desktop-Setup-<version>.exe`
- 对应 `.exe.blockmap`
- `SHA256SUMS.txt`
- `release-manifest.json`

本应用内的更新按钮更新的是 Harness npm 内核，不是 Electron Setup，因此当前不发布容易产生误导的 `latest.yml`。桌面安装包更新通过 GitHub Release 发布。

## 安全与许可证

- 安全问题报告方式见 [SECURITY.md](SECURITY.md)。
- 本仓库自有代码按 [MIT License](LICENSE) 发布。
- 第三方组件不自动适用本仓库的 MIT 许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 版本变化见 [CHANGELOG.md](CHANGELOG.md)。
