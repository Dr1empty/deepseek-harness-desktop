# 更新日志

本文只记录 Desktop 发行版的变化；Harness 内核变化请查看其[上游更新记录](https://github.com/deepseek-ai/deepseek-harness/releases)。

## 1.1.3 - 2026-08-22

- 删除所有第三方外加插件、插件 profile、归档与下载逻辑，只保留 Harness 官方核心组件和 Desktop 自有功能。
- 补充 Fork 根目录的中英文 Desktop 首页、下载入口和非官方声明。
- 删除旧的非 Desktop 打包配置和命令，清理无效的旧名称构建残留。
- 澄清实验性视觉模型与 Harness 图片路由的能力边界。
- CI 增加真实 NSIS Setup 构建和发布文件校验。

## 1.1.2 - 2026-08-22

- 将产品、安装包、构建任务和 GitHub 仓库名称统一为 Desktop。
- 首次运行 Desktop 版时自动迁移旧发行名称的用户数据。
- 将 Desktop 源码直接集成到上游 Harness Fork 的 `apps/desktop`。

## 1.1.1 - 2026-08-22

- 将 Harness 内核更新至 `@deepseek-ai/dsh@0.1.1-rc.2`。
- 增加设置内的软件更新栏目，支持检查和立即更新 Harness 内核。
- 增加单实例锁，重复点击快捷方式只激活现有窗口。
- 增加 DeepSeek 用量、余额、低余额提醒和原生二维码充值界面。
- 修复余额刷新提示、低余额通知清理、支付网页残留和 EPIPE 日志崩溃问题。
- 默认配置 `deepseek-v4-flash-vision-exp` 实验性视觉模型；Flash/Pro 的图片处理取决于当前 Harness 运行时能力，不将其描述为模型原生多模态。
- 当时的 Desktop 发行版曾包含两个第三方外加插件；自 1.1.3 起已全部移除。
- 增加可复现 Desktop 构建准备、发布哈希与发布清单生成流程。
