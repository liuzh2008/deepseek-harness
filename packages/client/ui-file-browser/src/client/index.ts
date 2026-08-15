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
import { FileBrowserAction, type FileBrowserInjected } from './FileBrowser.tsx'
import { en, zh, type FileBrowserLocaleKey } from './locales.ts'

export type { FileBrowserActionProps, FileBrowserInjected } from './FileBrowser.tsx'
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
 * Client plugin body: register the dialog's dictionaries and the footer action
 * into the sidebar's `sidebar.footer.action` hole through `slots.inject()`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'ui-file-browser: dictionaries')

  const injected = (): FileBrowserInjected => ({
    list: path => ctx.remote.fileBrowser.list(path === undefined ? {} : { path }),
    read: path => ctx.remote.fileBrowser.read({ path }),
    t: ctx.locale.bind(LOCALE_NS),
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'file-browser',
    order: 0,
    locale: LOCALE_NS,
    inject: injected,
  }, FileBrowserAction))
}
