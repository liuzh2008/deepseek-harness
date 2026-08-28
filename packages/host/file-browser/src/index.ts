/**
 * Project file browser host backend: a Typert Remote exposing read-only
 * directory listing (files AND directories, with sizes and mtimes), text
 * preview reads, and same-origin content URLs that stream file bytes for
 * browser rendering (images and web pages), all confined to the workspace
 * root for the listing default while any absolute host path stays browsable.
 * The browser half drives it from the Web UI; nothing renders on the host
 * display.
 * @module @deepseek-ai/dsh-host-file-browser
 */

import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {
  FileBrowserContentUrlRequest,
  FileBrowserContentUrlResult,
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
   * Absolute directory the browser opens at by default. Absent, the resolved
   * sandbox workspace root is used. A relative value is resolved against the
   * process cwd. The browser is NOT confined to this root — it only starts
   * here and may navigate anywhere on the host.
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

/** Web route prefix serving one file's raw bytes for browser rendering. */
const CONTENT_ROUTE_PREFIX = '/file-browser-content'

/** Base64url token alphabet (URL-safe, no separators). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

/** MIME types for the file kinds the content route renders (web pages and images). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

/** The content type the route answers with for one file (unknown kinds stream as octet-stream). */
function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
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
  static inject = ['sandboxPolicy', 'webServer']

  /** Loader validation for the listing and preview bounds. */
  static Config: z<Config> = z.object({
    root: z.string(),
    maxEntries: z.natural().min(1).default(1000),
    maxReadBytes: z.natural().min(1).default(262144),
  })

  /** The absolute directory the browser opens at by default. */
  readonly root: string
  private readonly maxEntries: number
  private readonly maxReadBytes: number

  /**
   * @param ctx - host context carrying the sandbox policy.
   * @param config - deployment bounds; `root` overrides the sandbox workspace root as the default opening directory.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'fileBrowser')
    this.root = resolve(config.root ?? ctx.sandboxPolicy.resolve().workspaceRoot)
    this.maxEntries = config.maxEntries
    this.maxReadBytes = config.maxReadBytes
    // Serve file bytes through the web server so the browser half can render
    // images and web pages directly. The route is prefix-owned and disposed
    // with the service; the handler decodes the base64url directory token and
    // streams the resolved file with a content type chosen from its extension.
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: CONTENT_ROUTE_PREFIX, handler: this.serveContent }),
      'file-browser: content route',
    )
  }

  /**
   * List one directory level. An absent path lists the browser's default
   * root; any other absolute path is browsable — the browser is not confined
   * to the root (it opens there by default but can navigate anywhere).
   * @param request - absolute directory to list; absent lists the default root.
   * @returns the level's listing with breadcrumb ancestry, or an explicit failure.
   */
  @Remote('list')
  async list(request: FileBrowserListRequest): Promise<FileBrowserListResult> {
    const { path } = request
    if (path !== undefined && !isAbsolute(path)) {
      return rejected({ code: 'path-not-absolute', path, message: `cannot list "${path}": not an absolute path` })
    }
    const target = resolve(path ?? this.root)
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
   * Any absolute path is readable — the browser is not confined to the root.
   * @param request - the absolute file path to read.
   * @returns decoded UTF-8 head text, or an explicit failure.
   */
  @Remote('read')
  async read(request: FileBrowserReadRequest): Promise<FileBrowserReadResult> {
    const { path } = request
    if (!isAbsolute(path)) {
      return rejected({ code: 'path-not-absolute', path, message: `cannot read "${path}": not an absolute path` })
    }
    const target = resolve(path)
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

  /**
   * Mint the same-origin content URL of one file, for browser rendering of
   * images and web pages. The URL encodes the file's parent directory as a
   * base64url token plus the percent-encoded base name, so a served HTML page
   * resolves its own relative references (images, scripts, stylesheets) back
   * into the same content route.
   * @param request - the absolute file path to serve.
   * @returns the content URL, or an explicit failure.
   */
  @Remote('contentUrl')
  async contentUrl(request: FileBrowserContentUrlRequest): Promise<FileBrowserContentUrlResult> {
    const { path } = request
    if (!isAbsolute(path)) {
      return rejected({ code: 'path-not-absolute', path, message: `cannot serve "${path}": not an absolute path` })
    }
    const target = resolve(path)
    let info
    try {
      info = await stat(target)
    } catch (error: unknown) {
      return rejected({ code: 'file-unreadable', path: target, message: `cannot serve ${target}: ${messageOf(error)}` })
    }
    if (info.isDirectory()) {
      return rejected({ code: 'file-unreadable', path: target, message: `cannot serve ${target}: is a directory` })
    }
    const dirToken = Buffer.from(dirname(target), 'utf8').toString('base64url')
    const url = `${CONTENT_ROUTE_PREFIX}/${dirToken}/${encodeURIComponent(basename(target))}`
    return success({
      path: target,
      url,
      bytes: info.size,
      mime: contentTypeOf(target),
    })
  }

  /**
   * Decode one content-route pathname into the absolute file it names. The
   * first segment is the base64url parent-directory token; anything after it
   * is a percent-encoded relative reference (an HTML page's own links and
   * resources), resolved under that directory. Returns undefined for any
   * malformed or non-absolute form — the caller answers 404.
   */
  private resolveContentTarget(pathname: string): string | undefined {
    const prefix = `${CONTENT_ROUTE_PREFIX}/`
    if (!pathname.startsWith(prefix)) return undefined
    const rest = pathname.slice(prefix.length)
    const slash = rest.indexOf('/')
    const token = slash === -1 ? rest : rest.slice(0, slash)
    if (!TOKEN_PATTERN.test(token)) return undefined
    const dir = Buffer.from(token, 'base64url').toString('utf8')
    if (!isAbsolute(dir)) return undefined
    let relative: string
    try {
      relative = decodeURIComponent(slash === -1 ? '' : rest.slice(slash + 1))
    } catch {
      return undefined
    }
    const target = resolve(dir, relative)
    return isAbsolute(target) ? target : undefined
  }

  /** Answer a content-route request by streaming the named file. */
  private readonly serveContent = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname: string
    try {
      /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server requests. */
      pathname = new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const target = this.resolveContentTarget(pathname)
    if (target === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    let info
    try {
      info = await stat(target)
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    if (!info.isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    // No-store: the file can change under the browser, and a cache of local
    // file contents is never desirable. nosniff keeps the bytes labeled.
    const headers: Record<string, string> = {
      'content-type': contentTypeOf(target),
      'content-length': String(info.size),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    const stream = createReadStream(target)
    /* v8 ignore next -- stream errors only surface on mid-flight IO failures. */
    stream.on('error', () => { res.destroy() })
    stream.pipe(res)
  }
}

export default FileBrowserGateway
