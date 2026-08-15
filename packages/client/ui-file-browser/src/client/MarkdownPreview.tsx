/**
 * Markdown preview for the file browser: renders `.md`/`.markdown` sources by
 * splitting ` ```mermaid ` fences out of the document and rendering each
 * fence as a live diagram, with every other region flowing through the shared
 * MarkdownText renderer (GFM tables, footnotes, KaTeX math). The same source
 * feeds {@link extractToc}, which powers the preview's table-of-contents
 * panel.
 */
import { useMemo, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { MermaidBlock } from './MermaidBlock.tsx'
import css from './FileBrowser.module.css'

/** One split region: an ordinary markdown slice or a mermaid-fence source. */
type PreviewRegion =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'mermaid'; readonly source: string }

/** One ` ```mermaid ` fence: opening delimiter, source, closing delimiter. */
const MERMAID_FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g

/** Split a markdown source into ordinary regions and mermaid-fence regions. */
function splitMermaid(text: string): PreviewRegion[] {
  const regions: PreviewRegion[] = []
  let last = 0
  for (const match of text.matchAll(MERMAID_FENCE)) {
    const index = match.index ?? 0
    if (index > last) regions.push({ kind: 'markdown', text: text.slice(last, index) })
    regions.push({ kind: 'mermaid', source: match[1] ?? '' })
    last = index + match[0].length
  }
  if (last < text.length) regions.push({ kind: 'markdown', text: text.slice(last) })
  return regions
}

/** Render one markdown source with live mermaid diagrams. */
export function MarkdownPreview({ source }: { source: string }) {
  const regions = useMemo(() => splitMermaid(source), [source])
  const children = useMemo<ReactNode[]>(() => {
    const out: ReactNode[] = []
    let markdownSeq = 0
    let mermaidSeq = 0
    for (const region of regions) {
      if (region.kind === 'markdown') {
        if (region.text.trim() === '') continue
        out.push(<MarkdownText key={`md-${markdownSeq++}`} text={region.text} />)
      } else {
        out.push(<MermaidBlock key={`mmd-${mermaidSeq++}`} source={region.source} className={css.mermaid} />)
      }
    }
    return out
  }, [regions])
  return <div className={css.markdownPreview}>{children}</div>
}

/** One heading entry extracted from a markdown source for its table of contents. */
export interface TocEntry {
  /** ATX heading level (1–6). */
  readonly level: number
  /** Heading text with inline markdown formatting stripped. */
  readonly text: string
}

/**
 * Reduce a heading's inline markdown to its plain display form: links and
 * images reduce to their label, inline code loses its backticks, emphasis
 * markers are removed, and the common HTML entities decode so the result can
 * be matched against the rendered heading's textContent.
 */
function plainHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** One ATX heading line: 1–6 `#` markers followed by whitespace and text. */
const ATX_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm

/**
 * Extract the document's ATX headings into table-of-contents entries. Fenced
 * code blocks — mermaid diagrams included — are masked out first so their
 * contents never contribute headings; setext underlines and headings nested
 * in blockquotes are intentionally not tracked.
 */
export function extractToc(source: string): TocEntry[] {
  const body = source.replace(/```[\s\S]*?(?:```|$)/g, '')
  const entries: TocEntry[] = []
  for (const match of body.matchAll(ATX_HEADING)) {
    const text = plainHeadingText(match[2] ?? '')
    if (text === '') continue
    entries.push({ level: (match[1] ?? '').length, text })
  }
  return entries
}
