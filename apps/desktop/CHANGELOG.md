# 更新日志

本文只记录 Desktop 发行版的变化；Harness 内核变化请查看其[上游更新记录](https://github.com/deepseek-ai/deepseek-harness/releases)。

## 1.1.2 - 2026-08-22

- 将产品、安装包、构建任务和 GitHub 仓库名称从 Clean 统一调整为 Desktop。
- 首次运行 Desktop 版时自动迁移旧发行名称的用户数据。
- 加入维护者账号下的官方 Harness Fork 链接。

## 1.1.1 - 2026-08-22

- 将 Harness 内核更新至 `@deepseek-ai/dsh@0.1.1-rc.2`。
- 增加设置内的软件更新栏目，支持检查和立即更新 Harness 内核。
- 增加单实例锁，重复点击快捷方式只激活现有窗口。
- 增加 DeepSeek 用量、余额、低余额提醒和原生二维码充值界面。
- 修复余额刷新提示、低余额通知清理、支付网页残留和 EPIPE 日志崩溃问题。
- 保留 `deepseek-v4-flash`、`deepseek-v4-pro` 的自动识图路径及 `deepseek-v4-flash-vision-exp` 视觉模型目录能力。
- Desktop 发行版保留滑动变阻器皮肤和超级模组注入器，不包含 Vision Router、iMessage 与质谱接口。
- 增加可复现 Desktop 构建准备、发布哈希与发布清单生成流程。
