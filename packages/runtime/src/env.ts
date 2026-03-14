/**
 * env.ts — Environment detection
 *
 * Detects whether Service Workers are available, whether we're in dev mode,
 * and other browser capabilities required by rawscript.
 */

export const env = {
  /** Whether Service Workers are supported in this browser */
  swSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,

  /** Whether ES modules are supported (noModule attribute exists on browsers with module support) */
  esmSupported:
    typeof document !== 'undefined' && 'noModule' in document.createElement('script'),

  /** Whether BroadcastChannel is supported */
  broadcastChannelSupported: typeof window !== 'undefined' && 'BroadcastChannel' in window,

  /** Whether fetch is supported */
  fetchSupported: typeof window !== 'undefined' && 'fetch' in window,

  /** Whether the Service Worker is currently active */
  isSWActive: false, // Set by boot.ts when SW registers successfully

  /** Whether we're in development mode (localhost/127.0.0.1) */
  isDev: typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname),

  /** Whether hot reload is enabled (dev mode only) */
  isHmrEnabled: false, // Set based on data-hmr-interval attribute

  /** SW polling interval in ms, or null if HMR disabled in production */
  hmrInterval: null as number | null, // Set from data-hmr-attribute

  /** Platform detection */
  platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',

  /** Browser user agent (truncated) */
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : 'unknown',
}