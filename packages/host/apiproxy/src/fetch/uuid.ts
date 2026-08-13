/** Secure-context-free UUID generation for wire correlation on any origin. */

/**
 * Generate an RFC 4122 version 4 UUID without requiring a secure context.
 *
 * `crypto.randomUUID` only exists on secure origins (HTTPS, localhost) and in
 * Node ≥19; a plain-HTTP LAN origin (e.g. `http://192.168.x.x`) does not expose
 * it, so the call would throw. `crypto.getRandomValues` is available on every
 * origin and backs the fallback path with the same version-4 layout.
 * @returns a version 4 UUID string.
 */
export function randomUuid(): string {
  const runtime = globalThis.crypto
  if (typeof runtime?.randomUUID === 'function') return runtime.randomUUID()
  const bytes = runtime.getRandomValues(new Uint8Array(16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40)
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80)
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
