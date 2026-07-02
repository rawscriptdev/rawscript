/**
 * serve.ts — Static file server for a directory, no config
 *
 * Serves a directory on the configured port with correct MIME types for
 * .ts/.tsx/.wasm and ETag / Last-Modified headers so rawscript's HMR
 * polling works. Traversal-safe and query-string tolerant.
 *
 * Security (roadmap Phase D — items 24 + 28):
 * - path traversal matrix: `../`, percent-encoded `../`, encoded separators
 *   (`%2f`, `%5c`), double encoding, mixed separators, NUL bytes and
 *   absolute-path attempts all resolve inside the root or are rejected
 * - dotfiles (`.git`, `.env`, ...) and `node_modules` are never served
 * - symlink/junction escapes are rejected via realpath containment
 * - malformed percent-encoding is answered with 400, never a crash
 * - security headers are applied on every response; a Content-Security-Policy
 *   can be enabled explicitly (`--csp default|strict`) and is never imposed
 *   silently
 *
 * Shared by `rawscript serve` (dev, serves the working directory) and
 * `rawscript preview --dir` (production, serves built output exactly as it
 * would be deployed).
 */

import http from 'http'
import fs from 'fs'
import path from 'path'

const DEFAULT_PORT = 3000

export type CspMode = 'off' | 'default' | 'strict'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ts': 'application/typescript; charset=utf-8',
  '.tsx': 'application/typescript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * CSP policies (roadmap section 21). Both modes allow `wasm-unsafe-eval` —
 * the browser compiles the esbuild WASM binary from fetched bytes, which the
 * CSP spec treats as unsafe-eval. `default` additionally permits the
 * zero-config CDNs (unpkg compiler shim + WASM, esm.sh dependencies).
 * `strict` is the self-hosted policy: every resource comes from the origin.
 */
const CSP_POLICIES: Record<Exclude<CspMode, 'off'>, string> = {
  strict:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; " +
    "style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  default:
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' https://unpkg.com https://esm.sh; " +
    "worker-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self' data:; connect-src 'self' https://unpkg.com https://esm.sh; " +
    "manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
}

/**
 * Apply baseline security headers. The three always-on headers are safe for
 * every legitimate rawscript app; the CSP is opt-in (`--csp`).
 */
function applySecurityHeaders(res: http.ServerResponse, csp: CspMode): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (csp !== 'off') {
    res.setHeader('Content-Security-Policy', CSP_POLICIES[csp])
  }
}

function etagFor(stats: fs.Stats): string {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
}

/** Reject a decoded URL path segment that would expose private files. */
function isBlockedSegment(segment: string): boolean {
  if (segment.length === 0 || segment === '.' || segment === '..') return false
  if (segment.startsWith('.')) return true // .git, .env, .rawscript, ...
  if (segment === 'node_modules') return true
  return false
}

/**
 * Resolve a request URL to a safe path inside the root.
 *
 * Returns { status, path? } where a non-null status is a rejection to answer
 * directly. Paths that decode to `..`, NUL bytes, absolute paths, dotfiles or
 * `node_modules` are rejected; symlinks/junctions must resolve inside the
 * real root.
 */
function resolveRequestPath(rootAbs: string, url: string): { status?: number; path?: string } {
  let urlPath: string
  try {
    urlPath = decodeURIComponent((url ?? '/').split('?')[0])
  } catch {
    return { status: 400 } // malformed percent-encoding
  }
  if (urlPath.includes('\0')) return { status: 400 }
  if (urlPath === '') urlPath = '/'
  // A request URL always starts with '/'; what matters is whether the path
  // would escape the root via a drive-absolute form (e.g. /C:/... on Windows).
  if (path.isAbsolute(urlPath.replace(/^[/\\]+/, ''))) return { status: 400 }
  // A request target always starts with '/'; a backslash right after it is a
  // Windows drive-root shorthand (`\windows\win.ini`) — an explicit escape
  // attempt. (A bare leading backslash can never reach the server.)
  if (urlPath.startsWith('/\\')) return { status: 403 }

  const segments = urlPath.split('/')
  for (const segment of segments) {
    if (isBlockedSegment(segment)) return { status: 403 }
  }

  const filePath = path.join(rootAbs, urlPath === '/' ? 'index.html' : urlPath)
  const rel = path.relative(rootAbs, path.resolve(filePath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { status: 403 }

  let finalPath = path.resolve(rootAbs, rel)
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html')
  }

  // Symlink/junction escape: the path must stay inside the REAL root even
  // after resolving links. Non-existent paths fall through to the 404 below.
  try {
    const realRoot = fs.realpathSync(rootAbs)
    const realPath = fs.realpathSync(finalPath)
    const realRel = path.relative(realRoot, realPath)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return { status: 403 }
  } catch {
    // realpathSync throws for non-existent finalPath — that is a 404, not a
    // security rejection.
  }

  return { path: finalPath }
}

export function serveDir(root: string, port: number, label: string, csp: CspMode = 'off'): void {
  const rootAbs = path.resolve(root)

  console.log(`Rawscript ${label} running at http://localhost:${port}`)
  console.log(`Serving directory: ${rootAbs}`)
  if (csp !== 'off') console.log(`Content-Security-Policy: ${csp}`)
  console.log('Press Ctrl+C to stop')

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    applySecurityHeaders(res, csp)

    const resolved = resolveRequestPath(rootAbs, req.url ?? '/')
    if (resolved.status) {
      res.statusCode = resolved.status
      res.end(resolved.status === 403 ? 'Forbidden' : 'Bad Request')
      return
    }
    const finalPath = resolved.path as string

    fs.stat(finalPath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      const etag = etagFor(stats)
      res.setHeader('ETag', etag)
      res.setHeader('Last-Modified', stats.mtime.toUTCString())

      if (req.headers['if-none-match'] === etag) {
        res.statusCode = 304
        res.end()
        return
      }

      const type =
        path.basename(finalPath).toLowerCase() === 'importmap.json'
          ? 'application/importmap+json; charset=utf-8'
          : (MIME[path.extname(finalPath).toLowerCase()] ?? 'application/octet-stream')
      res.writeHead(200, { 'Content-Type': type })
      fs.createReadStream(finalPath).pipe(res)
    })
  })

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`)
  })

  server.on('error', (err: Error) => {
    console.error(`Server error: ${err}`)
    process.exit(1)
  })
}

export function serve(port: number, csp: CspMode = 'off'): void {
  serveDir(process.cwd(), port, 'dev server', csp)
}

// Direct execution: `node src/serve.ts` (dev convenience). The bundled
// cli.mjs never matches — there `serve` is invoked through index.ts.
if (process.argv[1]?.endsWith('serve.ts')) {
  const args = process.argv.slice(2)
  const portIndex = args.indexOf('--port')
  const cspIndex = args.indexOf('--csp')
  const port =
    portIndex !== -1 && args[portIndex + 1] ? parseInt(args[portIndex + 1], 10) : DEFAULT_PORT
  const csp = (cspIndex !== -1 && args[cspIndex + 1]) as CspMode ?? 'off'
  serveDir(process.cwd(), port, 'dev server', csp)
}