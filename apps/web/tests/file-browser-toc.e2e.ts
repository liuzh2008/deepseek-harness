// Web e2e scenario: the file browser's markdown preview table of contents,
// plus the fixed-width file list's hide/show control. Opens a staged markdown
// document through the real host fileBrowser Remote, toggles the TOC panel,
// and verifies the extracted headings — with fenced code content excluded —
// over the shipped bundles.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

describe('web e2e: file browser markdown table of contents', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // Stage a markdown document with nested headings and a fenced block whose
    // contents must never become headings, plus a file whose name overflows
    // the fixed-width list pane.
    const LONG_NAME = 'a-very-long-file-name-that-cannot-fit-in-the-fixed-list-pane.md'
    const docs = join(scaffold.workspaceCwd, 'docs')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'guide.md'), [
      '# Title',
      '',
      '## Section A',
      '',
      '### Sub A.1',
      '',
      '```ts',
      '# not a heading',
      '```',
      '',
      '## Section B',
      '',
    ].join('\n'), 'utf8')
    writeFileSync(join(scaffold.workspaceCwd, LONG_NAME), '# long name file\n', 'utf8')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    // Plain transport boot: the fixture client fakes settings.describe without
    // the ui-onboarding namespace, which would resurface the welcome dialog.
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('extracts and toggles a table of contents for markdown previews', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-file-browser-toc'))
    await page.getByRole('button', { name: 'File browser' }).click()
    const dialog = page.getByRole('dialog', { name: 'Project file browser' })
    await dialog.waitFor({ timeout: 10_000 })

    // The file list hides and restores without losing the preview pane.
    const folderRow = dialog.getByRole('button', { name: 'Folder docs' })
    await folderRow.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Hide file list' }).click()
    await expect.poll(() => folderRow.count(), { timeout: 5_000 }).toBe(0)
    await dialog.getByRole('button', { name: 'Show file list' }).click()
    await expect.poll(() => folderRow.count(), { timeout: 5_000 }).toBe(1)

    // A clipped name reveals itself on hover; a name that fits stays quiet.
    const LONG_NAME = 'a-very-long-file-name-that-cannot-fit-in-the-fixed-list-pane.md'
    const longRow = dialog.getByRole('button', { name: `File ${LONG_NAME}` })
    await longRow.waitFor({ timeout: 10_000 })
    await longRow.hover()
    await expect.poll(() => page.getByRole('tooltip').count(), { timeout: 3_000 }).toBe(1)
    expect(await page.getByRole('tooltip').textContent()).toBe(LONG_NAME)
    await folderRow.hover()
    await page.waitForTimeout(700)
    expect(await page.getByRole('tooltip').count()).toBe(0)

    await folderRow.click()
    await dialog.getByRole('button', { name: 'File guide.md' }).click()

    const toggle = dialog.getByRole('button', { name: 'TOC' })
    await toggle.waitFor({ timeout: 10_000 })
    await toggle.click()

    const panel = dialog.getByRole('navigation', { name: 'TOC' })
    await panel.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await panel.getByText('Section A').count()).toBe(1)
    expect(await panel.getByText('Sub A.1').count()).toBe(1)
    expect(await panel.getByText('Section B').count()).toBe(1)
    // Fenced-code content never contributes headings.
    expect(await panel.getByText('# not a heading').count()).toBe(0)

    // The toggle closes the panel again.
    await toggle.click()
    await expect.poll(() => panel.count(), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
