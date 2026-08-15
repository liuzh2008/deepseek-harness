/**
 * PDF export for the file browser preview using the browser's native print
 * dialog ("Save as PDF" / "Microsoft Print to PDF"). The rendered preview
 * DOM — including live mermaid SVGs, which stay vector — is cloned into a
 * hidden same-origin iframe with the page's styles copied in, and the iframe
 * is printed. The user picks the destination in the system dialog, and the
 * output is crisp at any zoom because nothing is rasterized.
 *
 * The preview must be mounted and settled (mermaid diagrams already
 * rendered) before export.
 */

/** A4 portrait page size in mm. */
const PAGE_WIDTH_MM = 210
/** Print margins (mm). */
const PAGE_MARGIN_MM = 12

/** Suggested PDF file name from the previewed path. */
function fileNameOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'preview'
  const stem = base.replace(/\.\w+$/, '')
  return `${stem || 'preview'}.pdf`
}

/** Escape text for safe interpolation into the print document HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Collect the page's effective stylesheet text: every <style> element plus
 * the cssRules of every same-origin stylesheet (CSS modules, theme tokens,
 * plugin styles). Cross-origin sheets are skipped silently.
 */
function collectStyles(): string {
  const parts: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (rules === null) continue
      let text = ''
      for (let i = 0; i < rules.length; i += 1) text += rules[i]?.cssText ?? ''
      if (text !== '') parts.push(text)
    } catch {
      // Cross-origin or inaccessible sheet — skip (its rules cannot be read).
    }
  }
  // Fall back to raw style tags for any sheet the rules API could not read.
  if (parts.length === 0) {
    for (const style of Array.from(document.querySelectorAll('style'))) {
      const text = style.textContent
      if (text !== null && text !== '') parts.push(text)
    }
  }
  return parts.join('\n')
}

/**
 * Export the preview element via the browser's print-to-PDF flow.
 * @param element - the settled preview DOM (markdown + mermaid rendered).
 * @param sourcePath - the previewed file path (drives the suggested name).
 * @returns whether the print dialog was launched.
 */
export async function exportPreviewToPdf(
  element: HTMLElement,
  sourcePath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const name = fileNameOf(sourcePath)
    // Clone the preview so the print document edits nothing live.
    const clone = element.cloneNode(true) as HTMLElement
    clone.style.margin = '0'
    clone.style.padding = '0'

    const styles = collectStyles()
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name)}</title>
<style>
@page {
  size: A4 portrait;
  margin: ${PAGE_MARGIN_MM}mm;
}
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1a1a1a;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body {
  width: ${PAGE_WIDTH_MM - PAGE_MARGIN_MM * 2}mm;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
/* The preview clone fills the printable area; markdown/diagram content
   inherits the host theme's element styles copied in below. */
#dsh-pdf-preview {
  width: 100%;
  overflow: visible;
}
#dsh-pdf-preview svg {
  max-width: 100% !important;
  height: auto !important;
}
#dsh-pdf-preview pre {
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
}
#dsh-pdf-preview img {
  max-width: 100% !important;
  height: auto !important;
}
#dsh-pdf-preview table {
  width: 100% !important;
  border-collapse: collapse;
}
#dsh-pdf-preview .md-code-block {
  page-break-inside: avoid;
}
${styles}
</style>
</head>
<body>
<div id="dsh-pdf-preview">${clone.outerHTML}</div>
</body>
</html>`

    // Hidden same-origin iframe: print() from its window shows the system
    // dialog (Save as PDF), where the user picks the destination.
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.setAttribute('aria-hidden', 'true')
    document.body.appendChild(frame)

    const frameDoc = frame.contentDocument
    if (frameDoc === null) {
      frame.remove()
      return { ok: false, message: 'could not create the print document' }
    }
    frameDoc.open()
    frameDoc.write(html)
    frameDoc.close()

    // Let the clone's images/SVG settle before printing.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 150)
    })

    const frameWindow = frame.contentWindow
    if (frameWindow === null) {
      frame.remove()
      return { ok: false, message: 'could not open the print document' }
    }
    frameWindow.focus()
    frameWindow.print()

    // Remove the frame once the print flow finishes; afterprint is the
    // reliable signal, with a timeout net for browsers that skip it.
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        frame.remove()
        resolve()
      }
      frameWindow.addEventListener('afterprint', finish, { once: true })
      window.setTimeout(finish, 10000)
    })

    return { ok: true }
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
