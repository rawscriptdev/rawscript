/**
 * scripts/serve.mjs — static file server for local dev + Playwright
 *
 * Serves the repo root on :3000 (override via PORT env or first argv).
 * Serves .ts/.tsx/.wasm with correct MIME types and ETag / Last-Modified
 * headers so the SW's HMR polling works. Traversal-safe.
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = parseInt(process.env.PORT ?? process.argv[2] ?? '3000', 10)

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

function etagFor(stats) {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath)

  const rel = path.relative(root, path.resolve(filePath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  let finalPath = path.resolve(root, rel)
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html')
  }

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
})
