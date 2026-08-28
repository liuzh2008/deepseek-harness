# @deepseek-ai/dsh-host-file-browser

[English](README.md) | 中文

面向 Web GUI 的只读项目文件浏览器 Remote。`FileBrowserGateway` 注册 `fileBrowser` 服务，并发布三个由 Typert 生成的直接 Remote：`fileBrowser/list`（单个目录层级，文件与目录都包含大小与修改时间）、`fileBrowser/read`（有界 UTF-8 文本预览）和 `fileBrowser/contentUrl`（同源内容 URL，流式返回文件原始字节供浏览器渲染——图片与网页）。浏览器默认打开在配置的根目录（未配置时使用解析出的沙箱工作区根），但**不限于此根目录**——任意绝对主机路径都可列目录、读取与提供内容，操作者可浏览主机上的任何位置。

列表先按目录优先、再按名称排序，并以 `maxEntries` 配置为界（被截断的层级会标记 `truncated`）；文本预览以 `maxReadBytes` 为界（更大的文件返回其 UTF-8 头部并带 `truncated` 标记）。内容 URL 把文件的父目录编码为 base64url token，挂在 `/file-browser-content` Web 路由下，因此被服务的 HTML 页面自身的相对引用（图片、脚本、样式表）都会解析回同一条路由；路由按文件扩展名选择 MIME 类型流式返回，并带 `Cache-Control: no-store`。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的文件浏览器不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **不限于默认根目录** —— 浏览器默认打开在配置的根目录，但可浏览主机上任何位置；这是只读的（列目录 + 有界预览 + 内容 URL），绝不是修改路径。
- **`read` 仅文本预览** —— `read` 按 UTF-8 解码并截断到配置的字节上限；二进制文件不做文本预览。图片与网页改由 `contentUrl` 渲染。
- **内容路由按设计不鉴权** —— 与 Remote 读取一致，`/file-browser-content` 路由信任操作者的浏览器（loopback 或 trusted-host 门）；它应答任意绝对主机路径，与插件"随处可浏览"的模型一致。
- **只读** —— 服务不可变；创建、重命名或删除文件不在本插件范围内。
