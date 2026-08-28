# @deepseek-ai/dsh-host-file-browser

English | [中文](README.zh.md)

Read-only project file browser Remote for the Web GUI. `FileBrowserGateway` registers the `fileBrowser` service and publishes three generated direct Remotes: `fileBrowser/list` (one directory level, files AND directories with size and mtime), `fileBrowser/read` (bounded UTF-8 text preview), and `fileBrowser/contentUrl` (a same-origin URL streaming the file's raw bytes for browser rendering — images and web pages). The browser opens at the configured default root (the resolved sandbox workspace root when absent) but is NOT confined to it — any absolute host path can be listed, read, and served, so the operator can navigate anywhere on the host.

The listing is sorted directories-first then by name, and bounded by the `maxEntries` config (truncated levels are flagged); text previews are bounded by `maxReadBytes` (larger files return their UTF-8 head with a `truncated` flag). Content URLs encode the file's parent directory as a base64url token under the `/file-browser-content` web route, so a served HTML page resolves its own relative references (images, scripts, stylesheets) back into the same route; the route streams with a MIME type chosen from the file extension and `Cache-Control: no-store`. Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only file browser registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Not confined to the default root** — the browser opens at the configured root but can navigate anywhere on the host; this is read-only (list + bounded preview + content URLs), never a mutation path.
- **Text preview only for the `read` Remote** — `read` decodes UTF-8 and truncates at the configured byte bound; binary files are not text-previewed. Images and web pages render through `contentUrl` instead.
- **Content route is unauthenticated by design** — like the Remote reads, the `/file-browser-content` route trusts the operator's browser (loopback or trusted-host gate); it answers any absolute host path, matching the plugin's browse-anywhere model.
- **No mutation** — the service is read-only; creating, renaming, or deleting files is out of scope for this plugin.
