# 第三方软件与素材说明

根目录 `LICENSE` 只适用于本仓库自行编写的 Electron 外壳、构建脚本和测试，不会改变第三方组件的许可证。

| 组件 | 版本 | 来源 | 许可证/说明 |
|---|---:|---|---|
| DeepSeek Harness | 0.1.1-rc.2 | https://github.com/deepseek-ai/deepseek-harness | MIT |
| Electron | 43.4.0 | https://github.com/electron/electron | MIT；发行包同时携带 Electron/Chromium 许可证文件 |
| electron-builder | 26.15.3 | https://github.com/electron-userland/electron-builder | MIT，仅用于构建 |
| electron-updater | 6.8.9 | https://github.com/electron-userland/electron-builder | MIT |
| qrcode-generator | 1.4.4 | https://github.com/kazuhikoarase/qrcode-generator | MIT |
| Node.js | 24.18.0 | https://nodejs.org/ | Node.js 许可证及其第三方声明随便携运行时提供 |

Desktop 1.1.5 不预装第三方外加插件，也不在仓库中保存外加插件归档。完整的 JavaScript 依赖许可清单可在打包后的 `LICENSES.chromium.html`、Harness 的 `THIRD_PARTY_NOTICES.md` 及各依赖包内查看。
