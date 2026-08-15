# @deepseek-ai/dsh-client-ui-file-browser

[English](README.md) | 中文

Web GUI 的侧边栏文件浏览器。浏览器半注册一个 `sidebar.footer.action` 贡献：一个文件夹按钮（宽栏带标签、窄栏为图标），点击打开项目文件浏览器对话框。对话框每次列出一个目录层级——按名称排序的文件与文件夹（含大小与面包屑祖先链）——可进入子文件夹，并可预览文本文件；全部通过 host 侧 [`dsh-host-file-browser`](../../host/file-browser/README.md) 的 Remote（`fileBrowser/list` 与 `fileBrowser/read`）经显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费。

对话框文案在本包注册（本包命名空间）。每次列目录与预览都按需从 Host 重新读取；客户端从不自行拼接路径段，也不持有文件状态。对话框关闭或更新的导航将其取代时，过期的在途响应会被作废。

对话框还提供 `fileBrowserOpener` 服务（`ctx.get('fileBrowserOpener')`）：对话视图把文件打开路由到它，因此点击产出文件 chip 或行内代码中的文件引用时，对话框会直接定位到该文件所在目录并自动预览该文件（目录目标则直接落在其自身列表）。仅当对话框挂载时服务才接受打开请求；否则调用方回退到 Host 的原生打开器。

## 模型体验

无，因为这个浏览器半只在 Web GUI 中渲染 Host 拥有的文件列表与预览，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅限工作区根** —— 对话框只列出 host 工作区根及其后代，遵循 host 后端的包含边界。
- **仅文本预览** —— 文件以有界 UTF-8 文本预览；不渲染二进制内容。
- **只读** —— 没有创建、重命名、移动或删除操作；浏览器只是查看面。
