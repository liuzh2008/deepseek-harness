// @vitest-environment jsdom
// FileBrowserAction component specs: the open-at-path controller face the
// `fileBrowserOpener` service drives, plus the opener service's accept gate.
// Mermaid is a browser-grade runtime; the preview assertions target plain
// text, and the module is stubbed so importing MarkdownPreview stays light.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FileBrowserAction, type FileBrowserOpenerController } from '../src/client/FileBrowser.tsx'
import { createFileBrowserOpener } from '../src/client/index.ts'
import type { FileBrowserEntry, FileBrowserListing } from '@deepseek-ai/dsh-host-file-browser/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

vi.mock('mermaid', () => ({ initialize: vi.fn(), render: vi.fn(() => Promise.resolve({ svg: '' })) }))

// Vitest runs without globals here, so Testing Library's auto-cleanup never
// registers; unmount each rendered tree so dialogs cannot pile up.
afterEach(() => { cleanup() })

/** Key-as-copy locale stub: every lookup renders its own key. */
const t = ((key: string) => key) as never

/** Remote carrier success. */
function remoteOk<T>(value: T): RemoteResult<T> { return { ok: true, value } }

/** Remote carrier failure (the transport shape; the component reads `.code`). */
function remoteError(code: string, message: string): RemoteResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

/** Business success. */
function businessOk<T>(value: T): { ok: true; value: T } { return { ok: true, value } }

/** Business failure of a browse operation. */
function businessError(code: string, path: string): { ok: false; error: { code: string; path: string; message: string } } {
  return { ok: false, error: { code, path, message: `cannot ${path}` } }
}

/** One directory-level listing for the fake host. */
function listing(path: string, root: string, entries: FileBrowserEntry[]): FileBrowserListing {
  const crumbs = []
  let current = path
  while (current !== '') {
    crumbs.unshift({ name: current.split(/[\\/]/).pop() ?? current, path: current })
    const at = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'))
    if (at <= 0) break
    current = current.slice(0, at)
  }
  return { path, root, crumbs, entries, truncated: false }
}

function fileEntry(name: string, path: string): FileBrowserEntry {
  return { name, path, kind: 'file', size: 11, mtimeMs: 0, hidden: false }
}

function dirEntry(name: string, path: string): FileBrowserEntry {
  return { name, path, kind: 'directory', size: 0, mtimeMs: 0, hidden: false }
}

/** Render the action and return the controller it registered. */
function mountAction(overrides: {
  list?: (path?: string) => Promise<RemoteResult<unknown>>
  read?: (path: string) => Promise<RemoteResult<unknown>>
} = {}) {
  const list = overrides.list ?? vi.fn(() => Promise.resolve(remoteOk(businessOk(listing('/w', '/w', [])))))
  const read = overrides.read ?? vi.fn(() => Promise.resolve(remoteOk(businessOk({ path: '', content: '', truncated: false, bytes: 0 }))))
  const registerController = vi.fn()
  const unregisterController = vi.fn()
  const view = render(
    <FileBrowserAction
      wide={false}
      list={list as never}
      read={read as never}
      t={t}
      registerController={registerController}
      unregisterController={unregisterController}
      // The runtime's global standard seat; this component never calls them.
      useSessions={() => { throw new Error('unused') }}
      useWorkspaces={() => { throw new Error('unused') }}
    />,
  )
  const controller = registerController.mock.calls[0]?.[0] as FileBrowserOpenerController
  return { view, controller, list, read, registerController, unregisterController }
}

describe('FileBrowserAction open-at-path controller', () => {

  it('registers a controller while mounted and unregisters it on unmount', () => {
    const { view, controller, unregisterController } = mountAction()
    expect(controller).toBeDefined()
    view.unmount()
    expect(unregisterController).toHaveBeenCalledWith(controller)
  })

  it('positions a file open on its parent level and auto-previews the file', async () => {
    const { controller, read } = mountAction({
      list: vi.fn((path?: string) => {
        if (path === '/w/notes/report.txt') {
          // A file does not list: the probe rejects, driving the parent path.
          return Promise.resolve(remoteOk(businessError('directory-unreadable', '/w/notes/report.txt')))
        }
        expect(path).toBe('/w/notes')
        return Promise.resolve(remoteOk(businessOk(listing('/w/notes', '/w', [fileEntry('report.txt', '/w/notes/report.txt')]))))
      }),
      read: vi.fn((path: string) => {
        expect(path).toBe('/w/notes/report.txt')
        return Promise.resolve(remoteOk(businessOk({ path: '/w/notes/report.txt', content: 'hello world', truncated: false, bytes: 11 })))
      }),
    })
    controller.openAt('/w/notes/report.txt')
    await screen.findByRole('dialog')
    // The file's own listing row and its preview both land.
    expect(screen.getByText('report.txt')).toBeTruthy()
    expect(screen.getByText('hello world')).toBeTruthy()
    // The preview path bar shows the workspace-relative spelling.
    expect(screen.getByText('notes/report.txt')).toBeTruthy()
    expect(read).toHaveBeenCalledWith('/w/notes/report.txt')
  })

  it('lands a directory open on its own listing without a preview', async () => {
    const { controller, read } = mountAction({
      list: vi.fn((path?: string) => {
        expect(path).toBe('/w/src')
        return Promise.resolve(remoteOk(businessOk(listing('/w/src', '/w', [dirEntry('app.ts', '/w/src/app.ts')]))))
      }),
      read: vi.fn(),
    })
    controller.openAt('/w/src')
    await screen.findByRole('dialog')
    expect(screen.getByText('app.ts')).toBeTruthy()
    // No file was named: the preview pane stays on its idle hint.
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByText('openFile')).toBeTruthy()
  })

  it('surfaces a parent-listing failure in the list pane', async () => {
    const { controller } = mountAction({
      list: vi.fn((path?: string) => {
        if (path === '/w/missing/report.txt') {
          return Promise.resolve(remoteOk(businessError('directory-unreadable', '/w/missing/report.txt')))
        }
        return Promise.resolve(remoteError('carrier', 'list parent failed'))
      }),
      read: vi.fn(),
    })
    controller.openAt('/w/missing/report.txt')
    await screen.findByRole('dialog')
    expect(screen.getByRole('alert')).toBeTruthy()
  })

})

describe('createFileBrowserOpener service gate', () => {

  it('declines until a controller registers, then forwards and clears', () => {
    const opener = createFileBrowserOpener()
    expect(opener.openAt('/w/a.txt')).toBe(false)
    const controller = { openAt: vi.fn() }
    opener.register(controller)
    expect(opener.openAt('/w/a.txt')).toBe(true)
    expect(controller.openAt).toHaveBeenCalledWith('/w/a.txt')
    // Unregistering a different controller is a no-op; the real one stays live.
    opener.unregister({ openAt: vi.fn() })
    expect(opener.openAt('/w/b.txt')).toBe(true)
    expect(controller.openAt).toHaveBeenCalledWith('/w/b.txt')
    opener.unregister(controller)
    expect(opener.openAt('/w/c.txt')).toBe(false)
  })

})
