# @deepseek-ai/dsh-host-file-browser

English | [中文](README.zh.md)

Read-only project file browser Remote for the Web GUI. `FileBrowserGateway` registers the `fileBrowser` service and publishes two generated direct Remotes: `fileBrowser/list` (one directory level, files AND directories with size and mtime) and `fileBrowser/read` (bounded UTF-8 text preview). Every operation is confined to the workspace root resolved from `ctx.sandboxPolicy`: non-absolute or escaping paths are rejected with a typed failure, so the browser can never read outside the project.

The listing is sorted directories-first then by name, and bounded by the `maxEntries` config (truncated levels are flagged); previews are bounded by `maxReadBytes` (larger files return their UTF-8 head with a `truncated` flag). Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only file browser registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Workspace-root confined** — the browser lists only the resolved sandbox workspace root and its descendants; navigating to arbitrary host paths is intentionally unsupported.
- **Text preview only** — `read` decodes UTF-8 and truncates at the configured byte bound; binary files are not detected or rendered.
- **No mutation** — the service is read-only; creating, renaming, or deleting files is out of scope for this plugin.
