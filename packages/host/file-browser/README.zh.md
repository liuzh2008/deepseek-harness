# @deepseek-ai/dsh-host-file-browser

[English](README.md) | 中文

面向 Web GUI 的只读项目文件浏览器 Remote。`FileBrowserGateway` 注册 `fileBrowser` 服务，并发布两个由 Typert 生成的直接 Remote：`fileBrowser/list`（单个目录层级，文件与目录都包含大小与修改时间）和 `fileBrowser/read`（有界 UTF-8 文本预览）。每次操作都被限制在从 `ctx.sandboxPolicy` 解析出的工作区根内：非绝对路径或越出根的路径都会以类型化失败拒绝，因此浏览器永远不会读到项目之外。

列表先按目录优先、再按名称排序，并以 `maxEntries` 配置为界（被截断的层级会标记 `truncated`）；预览以 `maxReadBytes` 为界（更大的文件返回其 UTF-8 头部并带 `truncated` 标记）。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的文件浏览器不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅限工作区根** —— 浏览器只列出解析出的沙箱工作区根及其后代；刻意不支持导航到任意主机路径。
- **仅文本预览** —— `read` 按 UTF-8 解码并截断到配置的字节上限；不检测或渲染二进制文件。
- **只读** —— 服务不可变；创建、重命名或删除文件不在本插件范围内。
