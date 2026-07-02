/**
 * limits.ts — resource limits for the in-browser compiler (roadmap section 20)
 *
 * A page's TypeScript sources are untrusted input to the in-browser compiler,
 * so every bounded resource has a limit enforced before it can be consumed:
 *
 * - maxSourceBytes   — a single .ts/.tsx source may not exceed 2 MB (checked
 *                      against Content-Length before the body is read and
 *                      against the decoded text after)
 * - maxModules       — the SW module graph (importer → importer chains) is
 *                      bounded so a pathological graph cannot grow without
 *                      bound
 * - maxCompileMs     — a single esbuild transform may not run longer than
 *                      30 s; a stuck compile is answered with a structured
 *                      timeout diagnostic instead of hanging the page
 * - maxCachedModules — the transpiled-output cache is capped at 500 entries;
 *                      oldest entries are evicted on overflow
 *
 * Limits are configurable per page via `window.rawscriptConfig.limits`, but
 * every value is clamped to a hard ceiling so a page cannot ask for more than
 * the defaults allow.
 */

export interface RawscriptLimits {
  maxSourceBytes: number
  maxModules: number
  maxCompileMs: number
  maxCachedModules: number
}

export const DEFAULT_LIMITS: RawscriptLimits = {
  maxSourceBytes: 2_000_000,
  maxModules: 20_000,
  maxCompileMs: 30_000,
  maxCachedModules: 500,
}

/** Hard ceilings — page config may only shrink the defaults, never grow them. */
export const HARD_CEILINGS: RawscriptLimits = {
  maxSourceBytes: 50_000_000,
  maxModules: 100_000,
  maxCompileMs: 120_000,
  maxCachedModules: 10_000,
}

export const FLOORS: RawscriptLimits = {
  maxSourceBytes: 1_024,
  maxModules: 1_000,
  maxCompileMs: 1_000,
  maxCachedModules: 50,
}

function clampInt(value: unknown, floor: number, ceil: number, def: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return def
  return Math.min(ceil, Math.max(floor, Math.floor(value)))
}

/** Sanitize an untrusted `limits` value into a safe, clamped configuration. */
export function parseLimits(raw: unknown): RawscriptLimits {
  const out = { ...DEFAULT_LIMITS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  out.maxSourceBytes = clampInt(
    r.maxSourceBytes,
    FLOORS.maxSourceBytes,
    HARD_CEILINGS.maxSourceBytes,
    DEFAULT_LIMITS.maxSourceBytes
  )
  out.maxModules = clampInt(
    r.maxModules,
    FLOORS.maxModules,
    HARD_CEILINGS.maxModules,
    DEFAULT_LIMITS.maxModules
  )
  out.maxCompileMs = clampInt(
    r.maxCompileMs,
    FLOORS.maxCompileMs,
    HARD_CEILINGS.maxCompileMs,
    DEFAULT_LIMITS.maxCompileMs
  )
  out.maxCachedModules = clampInt(
    r.maxCachedModules,
    FLOORS.maxCachedModules,
    HARD_CEILINGS.maxCachedModules,
    DEFAULT_LIMITS.maxCachedModules
  )
  return out
}

/**
 * Dependency-cache content-type allowlist (roadmap section 19 security):
 * only genuine module script, JSON and WASM payloads may be cached. Serving
 * an HTML error page or any other unexpected body from the dependency cache
 * would be a cache-poisoning primitive — so anything else is refused.
 */
const DEPENDENCY_MIME_ALLOWLIST = new Set([
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/json',
  'text/json',
  'application/importmap+json',
  'application/wasm',
])

export function isCachableDependencyMime(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  return DEPENDENCY_MIME_ALLOWLIST.has(contentType.split(';')[0].trim().toLowerCase())
}

/** Human-readable byte size for diagnostics ("2.0 MB", "512 KB", "900 B"). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}