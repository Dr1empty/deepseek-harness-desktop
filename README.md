> [!NOTE]
> **DeepSeek Harness Desktop for Windows**：本 Fork 在 [`apps/desktop`](apps/desktop/README.md) 中提供非官方 Windows 桌面版。
> 它在上游 Harness 之上增加 NSIS 一键安装、便携 Node.js、本地服务托管、单实例窗口、内核更新、用量与余额、原生二维码充值、启动优化和可验证发布；公开 Setup 不预装第三方外加插件。
> [查看完整功能说明](apps/desktop/README.md#相比上游增加了什么) · [下载 Releases](https://github.com/Dr1empty/deepseek-harness-desktop/releases)

# DeepSeek Harness Desktop

English | [中文](README.zh.md)

> This is an unofficial community fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). The Windows Desktop distribution in this repository is not a DeepSeek official product and is not endorsed or maintained by DeepSeek AI.

## Windows Desktop distribution

[Download the latest Windows x64 Setup](https://github.com/Dr1empty/deepseek-harness-desktop/releases/latest) or read the complete [Desktop documentation](apps/desktop/README.md).

The Desktop distribution packages the Web UI, Harness backend, and a portable Node.js runtime in an NSIS installer. Users do not need to install Node.js or pnpm. Its source, tests, privacy notice, and build configuration live in [`apps/desktop`](apps/desktop).

```powershell
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop\apps\desktop
npm ci
npm test
npm start
```

## Upstream Harness

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

### Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

### Run from `npm`

Install Node.js, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See the [Web UI guide](docs/user/guide/index.md).

### Run the Harness core from this fork

```sh
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding. Desktop uses its independent npm lockfile and is intentionally excluded from both the root pnpm and npm workspace graphs.

## Community and support

- Report Desktop-specific bugs through this fork's [Issues](https://github.com/Dr1empty/deepseek-harness-desktop/issues).
- Use the upstream [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) for Harness core questions.
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to plugin repositories for discoverability.
- Join the <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing and development

Desktop changes are documented in [`apps/desktop`](apps/desktop). For Harness core development, see [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/development.md), and the [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

Harness core and this fork's own Desktop code are provided under their respective [MIT licenses](LICENSE). Third-party components remain subject to their own terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the [Desktop third-party notices](apps/desktop/THIRD_PARTY_NOTICES.md).
