/**
 * Project file browser host backend: a Typert Remote exposing read-only
 * directory listing (files AND directories, with sizes and mtimes) and text
 * preview reads, confined to the workspace root. The browser half drives it
 * from the Web UI; nothing renders on the host display.
 * @module @deepseek-ai/dsh-host-file-browser
 */

import { Buffer } from 'node:buffer'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {
  FileBrowserCrumb,
  FileBrowserEntry,
  FileBrowserFailure,
  FileBrowserListRequest,
  FileBrowserListResult,
  FileBrowserReadRequest,
  FileBrowserReadResult,
  FileBrowserRejected,
  FileBrowserSuccess,
} from './types.ts'

export type * from './types.ts'

/** Deployment policy for the browser backend. */
export interface Config {
  /**
   * Absolute root the browser opens at and is confined to. Absent, the
   * resolved sandbox workspace root is used. A relative value is resolved
   * against the process cwd and then used as-is.
   */
  root?: string
  /** Complete-result bound of one listing level. */
  maxEntries: number
  /** Maximum UTF-8 bytes a preview read materializes (larger files truncate). */
  maxReadBytes: number
}

/** Build a frozen success branch. */
function success<T>(value: T): FileBrowserSuccess<T> {
  return Object.freeze({ ok: true, value: Object.freeze(value) })
}

/** Build a frozen business-failure branch. */
function rejected(error: FileBrowserFailure): FileBrowserRejected {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- node:fs rejects with Error instances; the String arm only satisfies the unknown narrowing. */
  return error instanceof Error ? error.message : String(error)
}

/**
 * Path containment check: `candidate` must resolve strictly inside (or equal)
 * `root`. Lexical normalization first, then a separator-aware prefix check so
 * `C:\root2` can never pass for root `C:\root`.
 * @param root - the confined absolute root.
 * @param candidate - the absolute path to test.
 * @returns whether candidate stays within root.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate.startsWith(prefix)
}

/** One breadcrumb row for the level's ancestry (root-to-level inclusive). */
function ancestryCrumbs(target: string): FileBrowserCrumb[] {
  const crumbs: FileBrowserCrumb[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * Read-only listing/read backend for the project file browser.
 * Registers the `fileBrowser` Remote namespace; the browser half consumes it
 * through the api-remotes assembly.
 */
export class FileBrowserGateway extends TypertRemoteService {
  static inject = ['sandboxPolicy']

  /** Loader validation for the listing and preview bounds. */
  static Config: z<Config> = z.object({
    root: z.string(),
    maxEntries: z.natural().min(1).default(1000),
    maxReadBytes: z.natural().min(1).default(262144),
  })

  /** The absolute root the browser is confined to (the configured project root). */
  readonly root: string
  private readonly maxEntries: number
  private readonly maxReadBytes: number

  /**
   * @param ctx - host context carrying the sandbox policy.
   * @param config - deployment bounds; `root` overrides the sandbox workspace root.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'fileBrowser')
    this.root = resolve(config.root ?? ctx.sandboxPolicy.resolve().workspaceRoot)
    this.maxEntries = config.maxEntries
    this.maxReadBytes = config.maxReadBytes
  }

  /**
   * List one directory level. An absent path lists the browser root; every
   * returned path is absolute and confined to the root.
   * @param request - absolute directory to list; absent lists the browser root.
   * @returns the level's listing with breadcrumb ancestry, or an explicit failure.
   */
  @Remote('list')
  async list(request: FileBrowserListRequest): Promise<FileBrowserListResult> {
    const { path } = request
    if (path !== undefined && !isAbsolute(path)) {
      return rejected({ code: 'path-not-absolute', path, message: `cannot list "${path}": not an absolute path` })
    }
    const target = resolve(path ?? this.root)
    if (!isWithinRoot(this.root, target)) {
      return rejected({ code: 'path-outside-root', path: target, message: `cannot list "${target}": outside the browser root` })
    }
    let names: string[]
    try {
      names = await readdir(target)
    } catch (error: unknown) {
      return rejected({ code: 'directory-unreadable', path: target, message: `cannot list ${target}: ${messageOf(error)}` })
    }
    // Gather every child row first so the sort can put directories before
    // files (the browser's natural reading order), then order each group by
    // name. Unreadable children (broken symlinks, permission gaps) are
    // skipped silently — the browser shows what it can enter.
    const rows: FileBrowserEntry[] = []
    for (const name of names) {
      const entryPath = join(target, name)
      try {
        const info = await stat(entryPath)
        rows.push({
          name,
          path: entryPath,
          kind: info.isDirectory() ? 'directory' : 'file',
          size: info.size,
          mtimeMs: info.mtimeMs,
          hidden: name.startsWith('.'),
        })
      } catch {
        continue
      }
    }
    rows.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    const truncated = rows.length > this.maxEntries
    const entries = rows.slice(0, this.maxEntries)
    return success({
      path: target,
      root: this.root,
      crumbs: ancestryCrumbs(target),
      entries,
      truncated,
    })
  }

  /**
   * Read one file's text preview, bounded by the deployment's byte limit.
   * @param request - the absolute file path inside the workspace root.
   * @returns decoded UTF-8 head text, or an explicit failure.
   */
  @Remote('read')
  async read(request: FileBrowserReadRequest): Promise<FileBrowserReadResult> {
    const { path } = request
    if (!isAbsolute(path)) {
      return rejected({ code: 'path-not-absolute', path, message: `cannot read "${path}": not an absolute path` })
    }
    const target = resolve(path)
    if (!isWithinRoot(this.root, target)) {
      return rejected({ code: 'path-outside-root', path: target, message: `cannot read "${target}": outside the browser root` })
    }
    let info
    try {
      info = await stat(target)
    } catch (error: unknown) {
      return rejected({ code: 'file-unreadable', path: target, message: `cannot read ${target}: ${messageOf(error)}` })
    }
    if (info.isDirectory()) {
      return rejected({ code: 'file-unreadable', path: target, message: `cannot read ${target}: is a directory` })
    }
    const head = await this.readHead(target)
    return success({
      path: target,
      content: head.content,
      truncated: head.truncated,
      bytes: info.size,
    })
  }

  /** Read at most maxReadBytes bytes and decode as UTF-8. */
  private async readHead(path: string): Promise<{ content: string; truncated: boolean }> {
    let buffer: Buffer
    let truncated = false
    try {
      const handle = await open(path, 'r')
      try {
        const { bytesRead, buffer: out } = await handle.read(Buffer.allocUnsafe(this.maxReadBytes), 0, this.maxReadBytes, 0)
        buffer = out.subarray(0, bytesRead)
        const fullSize = (await handle.stat()).size
        truncated = fullSize > this.maxReadBytes
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      /* v8 ignore next -- the fallback is a compatibility net for exotic filesystems; the primary path is covered by tests. */
      void error
      buffer = (await readFile(path)).subarray(0, this.maxReadBytes)
      truncated = buffer.length === this.maxReadBytes
    }
    // Strip a UTF-8 BOM if present.
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      buffer = buffer.subarray(3)
    }
    return { content: buffer.toString('utf8'), truncated }
  }
}

export default FileBrowserGateway
