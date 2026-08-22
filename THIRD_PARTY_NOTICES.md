# 第三方软件与素材说明

根目录 `LICENSE` 只适用于本仓库自行编写的 Electron 外壳、构建脚本和测试，不会改变第三方组件的许可证。

| 组件 | 版本 | 来源 | 许可证/说明 |
|---|---:|---|---|
| DeepSeek Harness | 0.1.1-rc.2 | https://github.com/deepseek-ai/deepseek-harness | MIT |
| Electron | 43.4.0 | https://github.com/electron/electron | MIT；发行包同时携带 Electron/Chromium 许可证文件 |
| electron-builder | 26.15.3 | https://github.com/electron-userland/electron-builder | MIT，仅用于构建 |
| qrcode-generator | 1.4.4 | https://github.com/kazuhikoarase/qrcode-generator | MIT |
| Node.js | 24.18.0 | https://nodejs.org/ | Node.js 许可证及其第三方声明随便携运行时提供 |
| dsh-super-injector | 0.3.3 | https://github.com/yjh051108/dsh-super-injector | 包元数据声明 BSD-3-Clause；以其上游条款为准 |
| dsh-liang-skin | 0.1.4 | https://github.com/kingOfSoySauce/dsh-liang-skin | 上游发布包和仓库在本版本未提供许可证声明；不属于本项目 MIT 授权范围，相关代码与素材权利归上游权利人所有 |

CLEAN 构建脚本校验两个插件的固定归档 SHA-256。皮肤从固定上游 Release 下载，Release 不可达时从固定 Git 提交生成同哈希归档；超级注入器因其上游源码构建依赖已经不可从 npm 获取，仓库保留一份未经修改的上游 v0.3.3 Release 归档。完整的 JavaScript 依赖许可清单可在打包后的 `LICENSES.chromium.html`、Harness 的 `THIRD_PARTY_NOTICES.md` 及各依赖包内查看。
