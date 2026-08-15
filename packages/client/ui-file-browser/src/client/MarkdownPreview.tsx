/**
 * Markdown preview for the file browser: renders `.md`/`.markdown` sources by
 * splitting ` ```mermaid ` fences out of the document and rendering each
 * fence as a live diagram, with every other region flowing through the shared
 * MarkdownText renderer (GFM tables, footnotes, KaTeX math).
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
