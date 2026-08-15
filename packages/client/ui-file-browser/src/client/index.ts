/**
 * Browser half of the sidebar file browser: registers a footer action that
 * opens the project file browser dialog, driving the host's
 * `fileBrowser/list`/`fileBrowser/read` Remote primitives through the
 * api-remotes assembly. Mounting this package composes both sides of the
 * browse interaction with one cordis.yml row; no client code branches on a
 * capability kind. The dialog's copy is locale-registered here.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the sidebar footer action hole.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FileBrowserAction, type FileBrowserInjected, type FileBrowserOpenerController } from './FileBrowser.tsx'
import { en, zh, type FileBrowserLocaleKey } from './locales.ts'

export type { FileBrowserActionProps, FileBrowserInjected, FileBrowserOpenerController } from './FileBrowser.tsx'
export type { FileBrowserLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar file browser copy. */
    'file-browser': FileBrowserLocaleKey
  }
}

/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'file-browser'

/** Required services (cordis fiber inject): the slot registry, the remote namespace, and locale. */
export const inject = ['slots', 'locale', 'remote', 'remote.fileBrowser']

/**
 * The `fileBrowserOpener` service's consumer face (the contract the chat view
 * declares on the Context surface): open one Host-resolved absolute path in
 * the mounted dialog, or report that the surface is unavailable.
 */
export interface FileBrowserOpenerService {
  /**
   * Open the file browser dialog at `path`.
   * @param path - Host-resolved absolute path.
   * @returns true when the dialog is mounted and accepted the open; false
   * when the caller should fall back to the Host's native opener.
   */
  openAt(path: string): boolean
}

/**
 * The opener service plus its controller registration seam: the dialog
 * registers while mounted and unregisters on unmount, so the service's
 * accept gate tracks the surface's actual availability.
 */
export interface FileBrowserOpenerState extends FileBrowserOpenerService {
  /** Adopt the mounted dialog's controller (replaces any previous one). */
  register(controller: FileBrowserOpenerController): void
  /** Drop the controller when the dialog unmounts (must be the registered one). */
  unregister(controller: FileBrowserOpenerController): void
}

/** Build the opener service; no dialog is mounted until a controller registers. */
export function createFileBrowserOpener(): FileBrowserOpenerState {
  let controller: FileBrowserOpenerController | null = null
  return {
    openAt(path: string): boolean {
      if (controller === null) return false
      controller.openAt(path)
      return true
    },
    register(next: FileBrowserOpenerController): void { controller = next },
    unregister(next: FileBrowserOpenerController): void { if (controller === next) controller = null },
  }
}

/**
 * Client plugin body: register the dialog's dictionaries and the footer action
 * into the sidebar's `sidebar.footer.action` hole through `slots.inject()`,
 * and provide the `fileBrowserOpener` service the chat view routes file opens
 * through (optional-service convention: the service is the on switch, and the
 * dialog registering its controller while mounted is the "handled" gate).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'ui-file-browser: dictionaries')

  // The opener service holds the mounted dialog's controller; `openAt`
  // returns false while no dialog is mounted so a caller (the chat view)
  // falls back to the Host's native opener instead of dropping the open.
  const opener = createFileBrowserOpener()
  ctx.provide('fileBrowserOpener', opener)

  const injected = (): FileBrowserInjected => ({
    list: path => ctx.remote.fileBrowser.list(path === undefined ? {} : { path }),
    read: path => ctx.remote.fileBrowser.read({ path }),
    t: ctx.locale.bind(LOCALE_NS),
    // Arrow wrappers: the opener methods are state closures, not `this`-bound.
    registerController: (next) => { opener.register(next) },
    unregisterController: (next) => { opener.unregister(next) },
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'file-browser',
    order: 0,
    locale: LOCALE_NS,
    inject: injected,
  }, FileBrowserAction))
}
