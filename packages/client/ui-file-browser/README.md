# @deepseek-ai/dsh-client-ui-file-browser

English | [中文](README.zh.md)

Sidebar file browser for the Web GUI. The browser half registers a `sidebar.footer.action` occupant: a folder button (wide label, rail icon) that opens the project file browser dialog. The dialog lists one directory level at a time — name-sorted files and folders with sizes and breadcrumb ancestry — descends into folders, and previews text files, all through the host [`dsh-host-file-browser`](../../host/file-browser/README.md) Remote (`fileBrowser/list` and `fileBrowser/read`) consumed via the explicit [`api-remotes`](../../api/remotes/README.md) assembly.

The dialog's copy is locale-registered here (this package's namespace). Every listing and preview is re-read from the Host on demand; the client never joins path segments and holds no file state. A stale in-flight response is invalidated when the dialog closes or a newer navigation supersedes it.

The dialog also provides a `fileBrowserOpener` service (`ctx.get('fileBrowserOpener')`): the chat view routes file opens through it, so clicking a produced-file chip or an inline-code file mention opens the dialog already positioned at the file's directory with the file auto-previewed (a directory target lands on its own listing). The service accepts an open only while the dialog is mounted; callers fall back to the Host's native opener otherwise.

## Model Experience

None, as this browser half only renders Host-owned file listings and previews in the Web GUI and registers no model interface.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **Workspace-root confined** — the dialog lists only the host workspace root and its descendants, per the host backend's containment.
- **Text preview only** — files preview as bounded UTF-8 text; binary content is not rendered.
- **Read-only** — no create, rename, move, or delete affordances; the browser is a viewing surface.
