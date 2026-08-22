# 隐私说明

DeepSeek Harness Clean 是在用户电脑上运行的桌面封装。本项目的 Electron 外壳不会把聊天内容、API Key、余额信息或支付信息发送给项目维护者。

## 本地数据

- 应用使用独立的用户数据目录和独立 DSH Home，避免与其他 Harness 安装相互污染。
- DeepSeek API Key 由 Harness 写入本机凭据文件；桌面外壳只在查询账户余额时读取该 Key。
- 用量统计从本机 Harness 事件记录汇总。
- 诊断日志写入 Windows 临时目录中的 `dsh-desktop.log`。

## 网络请求

应用会按功能需要连接以下服务：

- DeepSeek API：模型请求与账户余额查询。
- DeepSeek 平台：用户主动重新登录时显示登录页面；支付时请求支付订单和二维码数据。
- npm Registry：检查和安装 Harness 内核更新。
- GitHub 与 nodejs.org：仅在开发者执行 CLEAN 构建准备脚本时下载固定版本的构建依赖。

DeepSeek Harness 本体及用户安装的插件可能有各自的数据处理行为，请同时查阅相应上游项目的说明。本项目不会接收或保存用户的支付凭据；付款由支付宝或微信客户端处理。
