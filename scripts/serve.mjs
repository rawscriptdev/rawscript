/**
 * scripts/serve.mjs — static file server for local dev + Playwright
 *
 * Serves the repo root on :3000 (override via PORT env or first argv).
 * Serves .ts/.tsx/.wasm with correct MIME types and ETag / Last-Modified
 * headers so the SW's HMR polling works. Traversal-safe.
 *
 * Security (roadmap Phase D — items 24 + 28): same guarantees as the CLI
 * server — traversal matrix rejection, dotfile/node_modules blocking,
 * symlink containment, 400 on malformed percent-encoding, baseline security
 * headers, and an opt-in CSP via RAWSCRIPT_CSP=default|strict.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = parseInt(process.env.PORT ?? process.argv[2] ?? '3000', 10)
const csp = process.env.RAWSCRIPT_CSP ?? 'off'

const MIME = {
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

const CSP_POLICIES = {
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

function etagFor(stats) {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (csp !== 'off') res.setHeader('Content-Security-Policy', CSP_POLICIES[csp])
}

function isBlockedSegment(segment) {
  if (segment.length === 0 || segment === '.' || segment === '..') return false
  if (segment.startsWith('.')) return true
  if (segment === 'node_modules') return true
  return false
}

function resolveRequestPath(url) {
  let urlPath
  try {
    urlPath = decodeURIComponent((url ?? '/').split('?')[0])
  } catch {
    return { status: 400 }
  }
  if (urlPath.includes('\0')) return { status: 400 }
  if (urlPath === '') urlPath = '/'
  // A Windows drive-absolute target (`C:\...`) must be rejected on every host
  // OS, so detect it by string — `path.isAbsolute('C:/...')` is only true on
  // win32 and would let it fall through to a 404 on posix.
  if (/^[a-zA-Z]:[\\/]/.test(urlPath.replace(/^[/\\]+/, ''))) return { status: 400 }
  if (path.isAbsolute(urlPath.replace(/^[/\\]+/, ''))) return { status: 400 }
  // A request target always starts with '/'; a backslash right after it is a
  // Windows drive-root shorthand (`/\windows/win.ini`) — an explicit escape
  // attempt. (A bare leading backslash can never reach the server.)
  if (urlPath.startsWith('/\\')) return { status: 403 }

  for (const segment of urlPath.split('/')) {
    if (isBlockedSegment(segment)) return { status: 403 }
  }

  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath)
  const rel = path.relative(root, path.resolve(filePath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { status: 403 }

  let finalPath = path.join(root, rel)
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html')
  }

  try {
    const realRoot = fs.realpathSync(root)
    const realPath = fs.realpathSync(finalPath)
    const realRel = path.relative(realRoot, realPath)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) return { status: 403 }
  } catch {
    // realpathSync throws for non-existent finalPath — that is a 404, not a
    // security rejection.
  }

  return { path: finalPath }
}

const server = http.createServer((req, res) => {
  applySecurityHeaders(res)

  const resolved = resolveRequestPath(req.url ?? '/')
  if (resolved.status) {
    res.statusCode = resolved.status
    res.end(resolved.status === 403 ? 'Forbidden' : 'Bad Request')
    return
  }
  const finalPath = resolved.path

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

    const type = MIME[path.extname(finalPath).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    fs.createReadStream(finalPath).pipe(res)
  })
})

server.listen(port, () => {
  console.log(`rawscript dev server: http://localhost:${port}`)
  if (csp !== 'off') console.log(`Content-Security-Policy: ${csp}`)
})