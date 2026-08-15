/**
 * Sidebar file-browser action and dialog. The action is the `sidebar.footer.action`
 * occupant: a folder button that opens the browser. The dialog lists one
 * directory level at a time (breadcrumb ancestry, name-sorted files and
 * folders), descends into folders, and previews text files through the Host
 * `fileBrowser` Remote. All paths are host-owned absolute paths; the client
 * never joins segments.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronRightOutline14, IconCloseOutline16, IconCopyOutline16, IconFolderClose16,
  IconFolderOpenOutline16, IconFullscreenOutline16, IconRefreshOutline16, Modal, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FileBrowserEntry, FileBrowserListing, FileBrowserListResult, FileBrowserReadResult,
} from '@deepseek-ai/dsh-host-file-browser/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { MarkdownPreview } from './MarkdownPreview.tsx'
import css from './FileBrowser.module.css'

/** Owner-supplied browser props: browse calls and copy. */
export interface FileBrowserInjected {
  /** List one directory level (absent path = the workspace root). */
  list: (path?: string) => Promise<RemoteResult<FileBrowserListResult>>
  /** Read one text file's bounded preview. */
  read: (path: string) => Promise<RemoteResult<FileBrowserReadResult>>
  /** Localized dialog copy (this package's namespace). */
  t: TranslateNS<'file-browser'>
}
/** Full component props assembled by the sidebar footer-action slot renderer. */
export type FileBrowserActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'file-browser'>
  & InjectFace<FileBrowserInjected>

/** Failure text from a Remote result or a thrown value. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Unwrap the carrier's RemoteResult and the business result into the value or an error message. */
function unwrapRemote<T>(result: RemoteResult<T>): { ok: true; value: T } | { ok: false; message: string } {
  if (!result.ok) return { ok: false, message: `remote error: ${result.error.code ?? 'unknown'}` }
  return { ok: true, value: result.value }
}

/** Format a byte count for display. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The file's path relative to the browser root, with forward-slash separators
 * regardless of host platform (the display form of a project-relative path).
 * Falls back to the basename when the path is not under the root.
 */
function relativePath(path: string, root: string): string {
  if (path === root) return '.'
  const prefix = root.endsWith('\\') || root.endsWith('/') ? root : `${root}${path.includes('\\') ? '\\' : '/'}`
  if (!path.startsWith(prefix)) return path.split(/[\\/]/).pop() ?? path
  return path.slice(prefix.length).replace(/\\/g, '/')
}

/** Whether a previewed file should render as Markdown (mermaid-capable). */
function isMarkdownFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path
  return /\.(md|markdown|mdx)$/i.test(base)
}

/** localStorage key for the user-adjusted list pane width (persisted across reloads). */
const LIST_WIDTH_KEY = 'dsh.file-browser.listWidth'

/** Read the persisted list width, or null when absent/invalid. */
function readPersistedListWidth(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LIST_WIDTH_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as unknown
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** Persist the list width; storage failures only disable persistence. */
function writePersistedListWidth(value: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LIST_WIDTH_KEY, JSON.stringify(Math.round(value)))
  } catch (error) {
    console.error('file-browser: list width persistence failed:', error)
  }
}

/** One row: the entry's icon, name, and (for files) size; folders get a
 *  copy-relative-path control beside the row (independent of open). */
function EntryRow({ entry, root, onOpen, t }: {
  entry: FileBrowserEntry
  root: string
  onOpen: (entry: FileBrowserEntry) => void
  t: TranslateNS<'file-browser'>
}) {
  const isDir = entry.kind === 'directory'
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={css.row}
      data-kind={entry.kind}
      aria-label={isDir ? `${t('directory')} ${entry.name}` : `${t('file')} ${entry.name}`}
      onClick={() => { onOpen(entry) }}
    >
      {isDir
        ? <IconFolderClose16 size={16} className={css.rowIcon} />
        : <IconChevronRightOutline14 size={14} className={css.rowIcon} />}
      <span className={css.rowName}>{entry.name}</span>
      {isDir
        ? (
          <span
            role="button"
            tabIndex={0}
            className={css.rowCopy}
            aria-label={t('copyPath')}
            title={t('copyPath')}
            onClick={(event) => {
              event.stopPropagation()
              void writeClipboard(relativePath(entry.path, root)).then((ok) => {
                if (!ok) return
                setCopied(true)
                window.setTimeout(() => { setCopied(false) }, 1000)
              })
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              void writeClipboard(relativePath(entry.path, root)).then((ok) => {
                if (!ok) return
                setCopied(true)
                window.setTimeout(() => { setCopied(false) }, 1000)
              })
            }}
          >
            <IconCopyOutline16 size={13} />
            {copied ? t('copied') : ''}
          </span>
        )
        : <span className={css.rowSize}>{formatBytes(entry.size)}</span>}
    </button>
  )
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; listing: FileBrowserListing }

type ReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; path: string; content: string; truncated: boolean }

/**
 * Render the footer action button and the file browser dialog.
 * @param props - slot owner share + injected browse calls + copy.
 * @returns the action button (always mounted) and the dialog (while open).
 */
export function FileBrowserAction({ wide, list, read, t }: FileBrowserActionProps) {
  const [open, setOpen] = useState(false)
  // Maximized dialog state (toggled by the header fullscreen control).
  const [maximized, setMaximized] = useState(false)
  // List-pane width in px once the user drags the divider (null = default
  // ratio); seeded from the persisted value so a reload restores the layout.
  const [listWidth, setListWidth] = useState<number | null>(readPersistedListWidth)
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [readState, setReadState] = useState<ReadState>({ status: 'idle' })
  // The level currently displayed (kept across dialog opens so navigation
  // state survives a close/reopen within the same page session).
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined)
  // Post-copy confirmation for the relative-path button (1s window).
  const [pathCopied, setPathCopied] = useState(false)
  const requestSeq = useRef(0)

  const load = useCallback((path?: string) => {
    const seq = ++requestSeq.current
    setListState({ status: 'loading' })
    setReadState({ status: 'idle' })
    list(path).then((result) => {
      if (seq !== requestSeq.current) return
      const unwrapped = unwrapRemote(result)
      if (!unwrapped.ok) {
        setListState({ status: 'error', message: unwrapped.message })
        return
      }
      const business = unwrapped.value
      if (business.ok) setListState({ status: 'ready', listing: business.value })
      else setListState({ status: 'error', message: business.error.message })
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setListState({ status: 'error', message: failureText(reason) })
    })
  }, [list])

  // Every open starts fresh at the workspace root; a close invalidates any
  // in-flight response so a late arrival cannot repopulate a closed dialog.
  useEffect(() => {
    if (open) {
      load(currentPath)
      return
    }
    requestSeq.current += 1
    setReadState({ status: 'idle' })
  }, [open, load, currentPath])

  const openEntry = useCallback((entry: FileBrowserEntry) => {
    if (entry.kind === 'directory') {
      setCurrentPath(entry.path)
      load(entry.path)
      return
    }
    const seq = ++requestSeq.current
    setReadState({ status: 'loading' })
    read(entry.path).then((result) => {
      if (seq !== requestSeq.current) return
      const unwrapped = unwrapRemote(result)
      if (!unwrapped.ok) {
        setReadState({ status: 'error', message: unwrapped.message })
        return
      }
      const business = unwrapped.value
      if (business.ok) {
        setReadState({ status: 'ready', path: entry.path, content: business.value.content, truncated: business.value.truncated })
      } else {
        setReadState({ status: 'error', message: business.error.message })
      }
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setReadState({ status: 'error', message: failureText(reason) })
    })
  }, [read])

  const listing = listState.status === 'ready' ? listState.listing : null
  const crumbs = listing?.crumbs ?? []
  const entries = listing?.entries ?? []
  const busy = listState.status === 'loading'

  // Divider drag: the list pane takes a fixed pixel width while dragging
  // (clamped to sane bounds); a null width keeps the default 52/48 ratio.
  // The live width rides a ref so the mouseup handler persists the final
  // value without stale closure state.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const liveListWidth = useRef(listWidth)
  liveListWidth.current = listWidth
  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const body = bodyRef.current
    if (body === null) return
    const startX = event.clientX
    const startWidth = listWidth ?? body.getBoundingClientRect().width * 0.52
    const onMove = (move: MouseEvent): void => {
      const rect = body.getBoundingClientRect()
      const next = startWidth + (move.clientX - startX)
      const clamped = Math.min(Math.max(next, 160), rect.width - 240)
      setListWidth(clamped)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      const settled = liveListWidth.current
      if (settled !== null) writePersistedListWidth(settled)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [listWidth])

  return (
    <>
      <Tooltip label={t('actionLabel')} side="right" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.actionButton, wide && css.actionButtonWide)}
          aria-label={t('actionLabel')}
          title={t('actionLabel')}
          onClick={() => { setOpen(true) }}
        >
          <IconFolderOpenOutline16 size={wide ? 16 : 18} />
          {wide && <span className={css.actionLabel}>{t('actionLabel')}</span>}
        </button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        closeLabel={t('close')}
        title={t('browserTitle')}
        className={clsx(css.dialog, maximized && css.dialogMaximized) as string}
        headless
      >
        <div className={css.dialogBody}>
          <div className={css.headerBar}>
            <h2 className={css.title}>{t('browserTitle')}</h2>
            <div className={css.headerActions}>
              <button
                type="button"
                className={css.closeButton}
                aria-label={maximized ? t('restore') : t('maximize')}
                title={maximized ? t('restore') : t('maximize')}
                onClick={() => { setMaximized(v => !v) }}
              >
                <IconFullscreenOutline16 size={14} />
              </button>
              <button type="button" className={css.closeButton} aria-label={t('close')} onClick={() => { setOpen(false) }}>
                <IconCloseOutline16 size={14} />
              </button>
            </div>
          </div>

          <div className={css.crumbBar} role="navigation" aria-label={t('browserTitle')}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className={css.crumbSeat}>
                {index > 0 && <IconChevronRightOutline14 size={12} className={css.crumbChevron} />}
                <button
                  type="button"
                  className={css.crumb}
                  disabled={busy}
                  onClick={() => {
                    setCurrentPath(crumb.path)
                    load(crumb.path)
                  }}
                >
                  {index === 0 ? t('home') : crumb.name}
                </button>
              </span>
            ))}
            <span className={css.crumbGap} />
            <Tooltip label={t('refresh')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.refreshButton}
                aria-label={t('refresh')}
                disabled={busy}
                onClick={() => { load(listing?.path) }}
              >
                <IconRefreshOutline16 size={14} />
              </button>
            </Tooltip>
          </div>

          <div ref={bodyRef} className={css.body}>
            <div className={css.listArea} style={listWidth === null ? undefined : { width: listWidth, flex: '0 0 auto' }}>
              {listState.status === 'loading' && (
                <div className={css.status} role="status">{t('loading')}</div>
              )}
              {listState.status === 'error' && (
                <div className={css.error} role="alert">
                  <span>{t('error')} {listState.message}</span>
                  <Button variant="outline" size="sm" onClick={() => { load(listing?.path) }}>
                    {t('retry')}
                  </Button>
                </div>
              )}
              {listState.status === 'ready' && entries.length === 0 && (
                <div className={css.status}>{t('empty')}</div>
              )}
              {listState.status === 'ready' && entries.map(entry => (
                <EntryRow key={entry.path} entry={entry} root={listing?.root ?? ''} onOpen={openEntry} t={t} />
              ))}
              {listState.status === 'ready' && listing?.truncated === true && (
                <div className={css.status} role="status">{t('truncated')}</div>
              )}
            </div>

            <div
              className={css.resizer}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('resize')}
              onMouseDown={startResize}
            />

            <div className={css.previewArea}>
              {readState.status === 'idle' && (
                <div className={css.previewHint}>{t('openFile')}</div>
              )}
              {readState.status === 'loading' && (
                <div className={css.status} role="status">{t('readLoading')}</div>
              )}
              {readState.status === 'error' && (
                <div className={css.error} role="alert">{t('readError')} {readState.message}</div>
              )}
              {readState.status === 'ready' && (
                <>
                  <div className={css.pathBar}>
                    <span className={css.pathLabel} title={readState.path}>{t('pathLabel')}</span>
                    <span className={css.pathValue}>{relativePath(readState.path, listing?.root ?? '')}</span>
                    <button
                      type="button"
                      className={css.copyButton}
                      aria-label={t('copyPath')}
                      onClick={() => {
                        const rel = relativePath(readState.path, listing?.root ?? '')
                        void writeClipboard(rel).then((ok) => {
                          if (!ok) return
                          setPathCopied(true)
                          window.setTimeout(() => { setPathCopied(false) }, 1000)
                        })
                      }}
                    >
                      <IconCopyOutline16 size={13} />
                      {pathCopied ? t('copied') : t('copyPath')}
                    </button>
                  </div>
                  <div className={css.previewWrap}>
                    {isMarkdownFile(readState.path)
                      ? <MarkdownPreview source={readState.content} />
                      : (
                        <pre className={css.preview}>
                          {readState.content}
                          {readState.truncated && <div className={css.previewTruncated}>{t('readTruncated')}</div>}
                        </pre>
                      )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}
