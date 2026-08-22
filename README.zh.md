# DeepSeek Harness Desktop

[English](README.md) | 中文

> 本仓库是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方社区 Fork。仓库内的 Windows Desktop 发行版不是 DeepSeek 官方产品，也不代表 DeepSeek AI 的维护或背书。

## Windows Desktop 发行版

[下载最新 Windows x64 安装包](https://github.com/Dr1empty/deepseek-harness-desktop/releases/latest)，或查看完整的 [Desktop 使用与构建说明](apps/desktop/README.md)。

Desktop 版将 Web UI、Harness 后端和便携 Node.js 运行时封装为 NSIS 安装包，普通用户无需预装 Node.js 或 pnpm。其源码、测试、隐私说明和构建配置均位于 [`apps/desktop`](apps/desktop)。

```powershell
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop\apps\desktop
npm ci
npm test
npm start
```

## 上游 Harness

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

### 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

### 通过 `npm` 运行

安装 Node.js，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 从本 Fork 运行 Harness 内核

```sh
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。Desktop 使用独立 npm 锁文件，因此明确排除在根 pnpm workspace 之外。

## 社区与支持

- Desktop 专属问题请提交到本 Fork 的 [Issues](https://github.com/Dr1empty/deepseek-harness-desktop/issues)。
- Harness 内核问题可使用上游 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 为插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群；相关二维码与问卷见[上游中文 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md)。

## 参与贡献与开发

Desktop 相关说明位于 [`apps/desktop`](apps/desktop)。Harness 内核开发请参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)、[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

Harness 内核及本 Fork 自行编写的 Desktop 代码分别遵循对应的 [MIT 许可证](LICENSE)。第三方组件仍受其自身条款约束，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [Desktop 第三方说明](apps/desktop/THIRD_PARTY_NOTICES.md)。
