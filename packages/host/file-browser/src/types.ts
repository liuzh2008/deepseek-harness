/**
 * Public request, value, and failure vocabulary for the project file browser.
 * This module contains types only so generated Remote clients can consume it
 * without importing Host runtime code.
 * @module @deepseek-ai/dsh-host-file-browser/types
 */

/** One row of a directory listing: a file or a child directory. */
export interface FileBrowserEntry {
  /** Base name shown in a browser row. */
  readonly name: string
  /** Absolute host path — clients never join path segments themselves. */
  readonly path: string
  /** Whether the row is a file or an enterable directory. */
  readonly kind: 'file' | 'directory'
  /** File size in bytes (0 for directories). */
  readonly size: number
  /** Last-modification time in Unix epoch milliseconds. */
  readonly mtimeMs: number
  /** Hidden by the host platform's convention (dot-prefixed on POSIX). */
  readonly hidden: boolean
}

/** One breadcrumb row: an ancestor directory of the listed level. */
export interface FileBrowserCrumb {
  /** Base name shown in the crumb trail (the root crumb carries its full path). */
  readonly name: string
  /** Absolute host path; clicking jumps to this level. */
  readonly path: string
}

/** One directory level plus its ancestry, as the browser backend reports it. */
export interface FileBrowserListing {
  /** Absolute path of the listed directory. */
  readonly path: string
  /** Absolute root the browser is confined to (the workspace root). */
  readonly root: string
  /** Ancestor chain from the filesystem root to the listed directory inclusive. */
  readonly crumbs: readonly FileBrowserCrumb[]
  /** Direct children (files and directories), name-sorted. */
  readonly entries: readonly FileBrowserEntry[]
  /** True when the backend cut `entries` at its complete-result bound. */
  readonly truncated: boolean
}

/** List one directory level. */
export interface FileBrowserListRequest {
  /** Absolute directory to list; absent lists the workspace root. */
  readonly path?: string
}

/** Read one text file for preview. */
export interface FileBrowserReadRequest {
  /** Absolute path of the file to read (inside the workspace root). */
  readonly path: string
}

/** Text preview of one file, bounded by the deployment's size limit. */
export interface FileBrowserReadValue {
  /** Absolute path that was read. */
  readonly path: string
  /** Decoded UTF-8 text; truncated at the configured byte bound. */
  readonly content: string
  /** True when the file exceeded the bound and `content` is a head slice. */
  readonly truncated: boolean
  /** Total file size in bytes. */
  readonly bytes: number
}

/** Closed failure vocabulary of the file-browser operations. */
export type FileBrowserErrorCode =
  | 'root-missing'
  | 'path-outside-root'
  | 'path-not-absolute'
  | 'directory-unreadable'
  | 'file-unreadable'
  | 'not-a-text-file'

/** Typed failure of a file-browser operation. */
export interface FileBrowserFailure {
  readonly code: FileBrowserErrorCode
  /** Absolute path the failure is about. */
  readonly path: string
  /** Operator-facing description. */
  readonly message: string
}

/** Successful operation result. */
export interface FileBrowserSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected operation result with a stable business failure. */
export interface FileBrowserRejected {
  readonly ok: false
  readonly error: FileBrowserFailure
}

/** Result returned by the file-browser `list` operation. */
export type FileBrowserListResult =
  | FileBrowserSuccess<FileBrowserListing>
  | FileBrowserRejected

/** Result returned by the file-browser `read` operation. */
export type FileBrowserReadResult =
  | FileBrowserSuccess<FileBrowserReadValue>
  | FileBrowserRejected

/** Resolve one file's preview content URL. */
export interface FileBrowserContentUrlRequest {
  /** Absolute path of the file to serve raw content for. */
  readonly path: string
}

/** Content URL of one file, for browser rendering (images and web pages). */
export interface FileBrowserContentUrlValue {
  /** Absolute path the URL was minted for. */
  readonly path: string
  /**
   * Same-origin relative URL serving the file's raw bytes. The browser half
   * resolves it against the page origin; an HTML page's relative references
   * (images, scripts, stylesheets) resolve back into the same content route.
   */
  readonly url: string
  /** Total file size in bytes. */
  readonly bytes: number
  /** MIME type the content route answers with for this file. */
  readonly mime: string
}

/** Result returned by the file-browser `contentUrl` operation. */
export type FileBrowserContentUrlResult =
  | FileBrowserSuccess<FileBrowserContentUrlValue>
  | FileBrowserRejected
