/**
 * Sidebar file-browser action and dialog. The action is the `sidebar.footer.action`
 * occupant: a folder button that opens the browser. The dialog lists one
 * directory level at a time (breadcrumb ancestry, name-sorted files and
 * folders), descends into folders, and previews text files through the Host
 * `fileBrowser` Remote. All paths are host-owned absolute paths; the client
 * never joins segments.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChecklistOutline14, IconChevronRightOutline14, IconCloseOutline16, IconCopyOutline16,
  IconDownloadOutline16, IconFolderClose16, IconFolderOpenOutline16, IconFullscreenOutline16, IconPanelLeftOutline16,
  IconRefreshOutline16, Modal, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FileBrowserContentUrlResult, FileBrowserEntry, FileBrowserListing, FileBrowserListResult, FileBrowserReadResult,
} from '@deepseek-ai/dsh-host-file-browser/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { MarkdownPreview, extractToc, type TocEntry } from './MarkdownPreview.tsx'
import { exportPreviewToPdf } from './exportPdf.ts'
import css from './FileBrowser.module.css'

/** Owner-supplied browser props: browse calls and copy. */
export interface FileBrowserInjected {
  /** List one directory level (absent path = the workspace root). */
  list: (path?: string) => Promise<RemoteResult<FileBrowserListResult>>
  /** Read one text file's bounded preview. */
  read: (path: string) => Promise<RemoteResult<FileBrowserReadResult>>
  /** Resolve one file's same-origin content URL (for images and web pages). */
  contentUrl: (path: string) => Promise<RemoteResult<FileBrowserContentUrlResult>>
  /** Localized dialog copy (this package's namespace). */
  t: TranslateNS<'file-browser'>
  /**
   * Register the dialog's open-at-path controller while it is mounted; the
   * `fileBrowserOpener` service routes chat file opens through it.
   */
  registerController: (controller: FileBrowserOpenerController) => void
  /** Unregister the controller on unmount (must be the same object registered). */
  unregisterController: (controller: FileBrowserOpenerController) => void
}

/**
 * The mounted dialog's open-at-path face: the side the opener service calls.
 * The dialog navigates to a directory's own listing, or to a file's parent
 * level with the file auto-previewed.
 */
export interface FileBrowserOpenerController {
  /** Open the dialog at one Host-resolved absolute path. */
  openAt(path: string): void
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
  if (!result.ok) return { ok: false, message: `remote error: ${result.error.code}` }
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

/**
 * The parent directory of an absolute path, for either separator. A bare
 * drive designator (`C:`) and separator-free paths return the input
 * unchanged: the browser either lists such a target directly or fails on its
 * own terms (a file's parent can never be a drive designator).
 */
function parentDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (at <= 0) return path
  const parent = trimmed.slice(0, at)
  return /^[A-Za-z]:$/.test(parent) ? path : parent
}

/** Whether a previewed file should render as Markdown (mermaid-capable). */
function isMarkdownFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path
  return /\.(md|markdown|mdx)$/i.test(base)
}

/** Whether a previewed file should render as an image element. */
function isImageFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?)$/i.test(base)
}

/** Whether a previewed file should render as a web page (iframe). */
function isHtmlFile(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path
  return /\.(html?|xhtml)$/i.test(base)
}

/** Resolve a content-route relative URL against the page origin. */
function contentUrlAbsolute(relative: string): string {
  const location = (globalThis as { location?: { origin?: string } }).location
  const origin = location?.origin !== undefined && location.origin !== 'null' ? location.origin : ''
  return `${origin}${relative.startsWith('/') ? relative : `/${relative}`}`
}

/** One row: the entry's icon, name, and (for files) size; folders get a
 *  copy-relative-path control beside the row (independent of open). The name
 *  elides with ellipsis when the fixed list pane is narrower than it; a
 *  delayed hover tooltip then carries the full name, enabled only while the
 *  name is actually clipped. */
function EntryRow({ entry, root, onOpen, t, selected }: {
  entry: FileBrowserEntry
  root: string
  onOpen: (entry: FileBrowserEntry) => void
  t: TranslateNS<'file-browser'>
  /** Whether this row is the currently selected entry (its file is previewed). */
  selected: boolean
}) {
  const isDir = entry.kind === 'directory'
  const [copied, setCopied] = useState(false)
  const nameRef = useRef<HTMLSpanElement | null>(null)
  const [nameClipped, setNameClipped] = useState(false)
  useLayoutEffect(() => {
    const el = nameRef.current
    if (el === null) return
    const measure = () => { setNameClipped(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [entry.name])
  return (
    <Tooltip label={entry.name} side="right" delayMs={500} disabled={!nameClipped}>
      <button
        type="button"
        className={clsx(css.row, selected && css.rowSelected)}
        data-selected={selected || undefined}
        aria-current={selected ? 'true' : undefined}
        data-kind={entry.kind}
        aria-label={isDir ? `${t('directory')} ${entry.name}` : `${t('file')} ${entry.name}`}
        onClick={() => { onOpen(entry) }}
      >
        {isDir
          ? <IconFolderClose16 size={16} className={css.rowIcon} />
          : <IconChevronRightOutline14 size={14} className={css.rowIcon} />}
        <span ref={nameRef} className={css.rowName}>{entry.name}</span>
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
    </Tooltip>
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

type ContentUrlState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; path: string; url: string }

/**
 * Render the footer action button and the file browser dialog.
 * @param props - slot owner share + injected browse calls + copy.
 * @returns the action button (always mounted) and the dialog (while open).
 */
export function FileBrowserAction({ wide, list, read, contentUrl, t, registerController, unregisterController }: FileBrowserActionProps) {
  const [open, setOpen] = useState(false)
  // Maximized dialog state (toggled by the header fullscreen control).
  const [maximized, setMaximized] = useState(false)
  // List pane visibility (toggled by the crumb-bar control; kept across
  // dialog opens so a close/reopen within the session keeps the layout).
  const [listHidden, setListHidden] = useState(false)
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [readState, setReadState] = useState<ReadState>({ status: 'idle' })
  // Content-URL preview state (images and web pages; text files never use it).
  const [contentUrlState, setContentUrlState] = useState<ContentUrlState>({ status: 'idle' })
  // Whether the previewed image failed to load (renders a fallback hint).
  const [imageFailed, setImageFailed] = useState(false)
  // The level currently displayed (kept across dialog opens so navigation
  // state survives a close/reopen within the same page session).
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined)
  // The entry whose file is previewed (or the directory openAt landed on);
  // its listing row renders selected. Kept across opens so a revisit of the
  // same level restores the highlight.
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
  // Post-copy confirmation for the relative-path button (1s window).
  const [pathCopied, setPathCopied] = useState(false)
  // In-flight PDF export (disables the export button while running).
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // Markdown table of contents panel visibility (only offered for markdown).
  const [tocOpen, setTocOpen] = useState(false)
  const requestSeq = useRef(0)
  // A controller-driven open (openAt) drives list/read itself; the open flip
  // must not also refetch the stale level. The flag is consumed by the effect
  // below on the very next run, so it can never swallow a later navigation.
  const skipNextEffectLoad = useRef(false)

  const load = useCallback((path?: string) => {
    const seq = ++requestSeq.current
    setListState({ status: 'loading' })
    setReadState({ status: 'idle' })
    setContentUrlState({ status: 'idle' })
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
    const skipped = skipNextEffectLoad.current
    skipNextEffectLoad.current = false
    if (open) {
      if (skipped) return
      load(currentPath)
      return
    }
    requestSeq.current += 1
    setReadState({ status: 'idle' })
  }, [open, load, currentPath])

  // A new previewed file closes any open table of contents panel.
  const closedOn = readState.status === 'ready' ? readState.path : contentUrlState.status === 'ready' ? contentUrlState.path : undefined
  useEffect(() => {
    setTocOpen(false)
  }, [closedOn])

  /**
   * Preview one file: images and web pages resolve a content URL and render
   * directly (no text read); every other file reads its bounded UTF-8 text
   * preview. Sequence-guarded like the list/read calls so a stale response
   * can never overwrite a newer navigation.
   */
  const previewFile = useCallback((path: string) => {
    const seq = ++requestSeq.current
    setImageFailed(false)
    if (isImageFile(path) || isHtmlFile(path)) {
      setReadState({ status: 'idle' })
      setContentUrlState({ status: 'loading' })
      contentUrl(path).then((result) => {
        if (seq !== requestSeq.current) return
        const unwrapped = unwrapRemote(result)
        if (!unwrapped.ok) {
          setContentUrlState({ status: 'error', message: unwrapped.message })
          return
        }
        const business = unwrapped.value
        if (business.ok) {
          setContentUrlState({ status: 'ready', path: business.value.path, url: business.value.url })
        } else {
          setContentUrlState({ status: 'error', message: business.error.message })
        }
      }, (reason: unknown) => {
        if (seq !== requestSeq.current) return
        setContentUrlState({ status: 'error', message: failureText(reason) })
      })
      return
    }
    setContentUrlState({ status: 'idle' })
    setReadState({ status: 'loading' })
    read(path).then((result) => {
      if (seq !== requestSeq.current) return
      const unwrapped = unwrapRemote(result)
      if (!unwrapped.ok) {
        setReadState({ status: 'error', message: unwrapped.message })
        return
      }
      const business = unwrapped.value
      if (business.ok) {
        setReadState({ status: 'ready', path: business.value.path, content: business.value.content, truncated: business.value.truncated })
      } else {
        setReadState({ status: 'error', message: business.error.message })
      }
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setReadState({ status: 'error', message: failureText(reason) })
    })
  }, [read, contentUrl])

  /**
   * The open-at-path controller face: probe the target as a directory (a
   * listing succeeds), otherwise land on its parent level and auto-preview
   * the file. Drives list/read directly so the dialog can open already
   * positioned; the open-effect's own load is suppressed for that flip.
   */
  const openAt = useCallback((target: string) => {
    if (!open) skipNextEffectLoad.current = true
    setOpen(true)
    const seq = ++requestSeq.current
    setListState({ status: 'loading' })
    setReadState({ status: 'idle' })
    list(target).then((result) => {
      if (seq !== requestSeq.current) return
      const unwrapped = unwrapRemote(result)
      if (unwrapped.ok && unwrapped.value.ok) {
        // Directory target: its own listing IS the destination level.
        setSelectedPath(target)
        setListState({ status: 'ready', listing: unwrapped.value.value })
        return
      }
      // File target: list the parent for context, then preview the file.
      const parent = parentDirectory(target)
      list(parent).then((parentResult) => {
        if (seq !== requestSeq.current) return
        const parentUnwrapped = unwrapRemote(parentResult)
        if (!parentUnwrapped.ok) {
          setListState({ status: 'error', message: parentUnwrapped.message })
          return
        }
        const parentBusiness = parentUnwrapped.value
        if (!parentBusiness.ok) {
          setListState({ status: 'error', message: parentBusiness.error.message })
          return
        }
        setListState({ status: 'ready', listing: parentBusiness.value })
        // The backend reads any absolute path, so a truncated or name-sorted
        // listing cannot block the preview of the named file.
        setSelectedPath(target)
        previewFile(target)
      }, (reason: unknown) => {
        if (seq !== requestSeq.current) return
        setListState({ status: 'error', message: failureText(reason) })
      })
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setListState({ status: 'error', message: failureText(reason) })
    })
  }, [list, open, previewFile])

  // Register the controller once, forwarding through a ref so the service
  // always reaches the latest callback without re-registering on identity
  // churn. The opener service only exists while this dialog is mounted.
  const openAtRef = useRef<FileBrowserOpenerController['openAt']>(() => {})
  openAtRef.current = openAt
  useEffect(() => {
    const controller: FileBrowserOpenerController = { openAt: (path) => { openAtRef.current(path) } }
    registerController(controller)
    return () => { unregisterController(controller) }
  }, [registerController, unregisterController])

  const openEntry = useCallback((entry: FileBrowserEntry) => {
    setSelectedPath(entry.path)
    if (entry.kind === 'directory') {
      setCurrentPath(entry.path)
      load(entry.path)
      return
    }
    previewFile(entry.path)
  }, [previewFile])

  const listing = listState.status === 'ready' ? listState.listing : null
  const crumbs = listing?.crumbs ?? []
  const entries = listing?.entries ?? []
  const busy = listState.status === 'loading'

  // The path shown in the preview bar: the text-read path or the content-URL
  // path (images and web pages never take the text-read branch).
  const previewedPath = readState.status === 'ready'
    ? readState.path
    : contentUrlState.status === 'ready'
      ? contentUrlState.path
      : undefined

  // PDF export of the rendered preview (mermaid diagrams included). The
  // export targets the preview body element so only the file content lands
  // in the document. Text-only: images and web pages have no DOM to export.
  const previewRef = useRef<HTMLDivElement | null>(null)
  const handleExportPdf = useCallback(() => {
    const preview = previewRef.current
    if (preview === null || readState.status !== 'ready' || exporting) return
    setExporting(true)
    setExportError(null)
    void exportPreviewToPdf(preview, readState.path).then((result) => {
      setExporting(false)
      if (!result.ok) setExportError(result.message)
    })
  }, [readState, exporting])

  // Table of contents of the previewed markdown (empty for other files).
  const toc = useMemo<TocEntry[]>(() => (
    readState.status === 'ready' && isMarkdownFile(readState.path) ? extractToc(readState.content) : []
  ), [readState])

  // Scroll the rendered preview to the heading whose plain text matches the
  // TOC entry (rendered headings carry no ids, so matching goes by text).
  const scrollToHeading = useCallback((text: string) => {
    const wrap = previewRef.current
    if (wrap === null) return
    const target = text.replace(/\s+/g, ' ').trim().toLowerCase()
    for (const heading of wrap.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const headingText = heading.textContent.replace(/\s+/g, ' ').trim().toLowerCase()
      if (headingText === target) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
    }
  }, [])

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
        className={clsx(css.dialog, maximized && css.dialogMaximized)}
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
            <Tooltip label={listHidden ? t('showList') : t('hideList')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.refreshButton}
                aria-label={listHidden ? t('showList') : t('hideList')}
                aria-pressed={!listHidden}
                onClick={() => { setListHidden(hidden => !hidden) }}
              >
                <IconPanelLeftOutline16 size={14} />
              </button>
            </Tooltip>
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

          <div className={css.body}>
            {!listHidden && (
              <div className={css.listArea}>
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
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    root={listing?.root ?? ''}
                    onOpen={openEntry}
                    t={t}
                    selected={entry.path === selectedPath}
                  />
                ))}
                {listState.status === 'ready' && listing?.truncated === true && (
                  <div className={css.status} role="status">{t('truncated')}</div>
                )}
              </div>
            )}

            <div className={css.previewArea}>
              {readState.status === 'idle' && contentUrlState.status === 'idle' && (
                <div className={css.previewHint}>{t('openFile')}</div>
              )}
              {(readState.status === 'loading' || contentUrlState.status === 'loading') && (
                <div className={css.status} role="status">{t('readLoading')}</div>
              )}
              {readState.status === 'error' && (
                <div className={css.error} role="alert">{t('readError')} {readState.message}</div>
              )}
              {contentUrlState.status === 'error' && (
                <div className={css.error} role="alert">{t('contentError')} {contentUrlState.message}</div>
              )}
              {(readState.status === 'ready' || contentUrlState.status === 'ready') && (
                <>
                  <div className={css.pathBar}>
                    <span className={css.pathLabel} title={previewedPath}>{t('pathLabel')}</span>
                    <span className={css.pathValue}>{relativePath(previewedPath ?? '', listing?.root ?? '')}</span>
                    {previewedPath !== undefined && isMarkdownFile(previewedPath) && (
                      <button
                        type="button"
                        className={clsx(css.copyButton, tocOpen && css.copyButtonActive)}
                        aria-label={t('toc')}
                        aria-pressed={tocOpen}
                        disabled={toc.length === 0}
                        onClick={() => { setTocOpen(open => !open) }}
                      >
                        <IconChecklistOutline14 size={13} />
                        {t('toc')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={css.copyButton}
                      aria-label={t('copyPath')}
                      onClick={() => {
                        const rel = relativePath(previewedPath ?? '', listing?.root ?? '')
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
                    {readState.status === 'ready' && (
                      <button
                        type="button"
                        className={css.copyButton}
                        aria-label={t('exportPdf')}
                        disabled={exporting}
                        onClick={() => { handleExportPdf() }}
                      >
                        <IconDownloadOutline16 size={13} />
                        {exporting ? t('exporting') : t('exportPdf')}
                      </button>
                    )}
                  </div>
                  {exportError !== null && (
                    <div className={css.exportError} role="alert">{t('exportFailed')}: {exportError}</div>
                  )}
                  <div className={css.previewBody}>
                    {tocOpen && toc.length > 0 && (
                      <nav className={css.tocPanel} aria-label={t('toc')}>
                        <div className={css.tocTitle}>{t('toc')}</div>
                        <div className={css.tocList}>
                          {toc.map((entry, index) => (
                            <button
                              key={`${entry.level}-${index}`}
                              type="button"
                              className={css.tocItem}
                              style={{ paddingLeft: `${10 + (entry.level - 1) * 12}px` }}
                              title={entry.text}
                              onClick={() => { scrollToHeading(entry.text) }}
                            >
                              {entry.text}
                            </button>
                          ))}
                        </div>
                      </nav>
                    )}
                    <div
                      ref={previewRef}
                      className={clsx(
                        css.previewWrap,
                        contentUrlState.status === 'ready' && isHtmlFile(contentUrlState.path) && css.previewWrapFrame,
                      )}
                    >
                      {contentUrlState.status === 'ready' && isImageFile(contentUrlState.path) && (
                        imageFailed
                          ? <div className={css.previewHint}>{t('contentError')}</div>
                          : (
                            <img
                              className={css.previewImage}
                              src={contentUrlAbsolute(contentUrlState.url)}
                              alt={contentUrlState.path.split(/[\\/]/).pop() ?? contentUrlState.path}
                              onError={() => { setImageFailed(true) }}
                            />
                          )
                      )}
                      {contentUrlState.status === 'ready' && isHtmlFile(contentUrlState.path) && (
                        // sandbox without allow-same-origin: the page's scripts
                        // run but cannot reach the harness's origin or storage.
                        <iframe
                          className={css.previewFrame}
                          src={contentUrlAbsolute(contentUrlState.url)}
                          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                          title={contentUrlState.path.split(/[\\/]/).pop() ?? contentUrlState.path}
                        />
                      )}
                      {readState.status === 'ready' && (
                        isMarkdownFile(readState.path)
                          ? <MarkdownPreview source={readState.content} />
                          : (
                            <pre className={css.preview}>
                              {readState.content}
                              {readState.truncated && <div className={css.previewTruncated}>{t('readTruncated')}</div>}
                            </pre>
                          )
                      )}
                    </div>
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
