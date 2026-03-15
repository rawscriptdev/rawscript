/**
 * serve.ts — Static file server for the current directory, no config
 *
 * Serves the working directory on the configured port with correct MIME types
 * for .ts/.tsx/.wasm and ETag / Last-Modified headers so rawscript's HMR
 * polling works. Traversal-safe and query-string tolerant.
 */

import http from 'http'
import fs from 'fs'
import path from 'path'

const DEFAULT_PORT = 3000

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

function etagFor(stats: fs.Stats): string {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`
}

export function serve(port: number): void {
  const root = process.cwd()

  console.log(`Rawscript dev server running at http://localhost:${port}`)
  console.log(`Serving directory: ${root}`)
  console.log('Press Ctrl+C to stop')

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath)

    // Traversal guard: the resolved path must stay inside the root.
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
    console.log(`Server listening on port ${port}`)
  })

  server.on('error', (err: Error) => {
    console.error(`Server error: ${err}`)
    process.exit(1)
  })
}

// Direct execution: `node src/serve.ts` (dev convenience). The bundled
// cli.mjs never matches — there `serve` is invoked through index.ts.
if (process.argv[1]?.endsWith('serve.ts')) {
  const args = process.argv.slice(2)
  const portIndex = args.indexOf('--port')
  const port =
    portIndex !== -1 && args[portIndex + 1] ? parseInt(args[portIndex + 1], 10) : DEFAULT_PORT
  serve(port)
}
