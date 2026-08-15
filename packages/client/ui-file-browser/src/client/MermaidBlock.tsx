/**
 * Mermaid diagram renderer: renders one ` ```mermaid ` fence's source into an
 * inline SVG via the mermaid runtime (inlined into this plugin's bundle).
 * Runs once per source; a failed render falls back to a plain code block so
 * the source stays readable.
 */
import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

/** Lazily-initialized mermaid runtime (startOnLoad off; we render explicitly). */
let initialized = false
function ensureMermaid(): void {
  if (initialized) return
  initialized = true
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    // Deterministic font stack; the dialog has no external font dependency.
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  })
}

/** Render one mermaid diagram source into an SVG string (empty on failure). */
export async function renderMermaid(source: string): Promise<string> {
  ensureMermaid()
  try {
    const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, source)
    return svg
  } catch {
    return ''
  }
}

/** A self-contained diagram block with a loading/fallback lifecycle. */
export function MermaidBlock({ source, className }: { source: string; className?: string | undefined }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    setSvg(null)
    setFailed(false)
    void renderMermaid(source).then((result) => {
      if (!mounted.current) return
      if (result === '') setFailed(true)
      else setSvg(result)
    })
    return () => { mounted.current = false }
  }, [source])
  if (failed) {
    return (
      <pre className={className}><code>{source}</code></pre>
    )
  }
  if (svg === null) {
    return <div className={className} data-mermaid-loading>…</div>
  }
  // mermaid's output is a static SVG string it generated from the source; the
  // sanctioned consumption path per mermaid's own docs.
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />
}
