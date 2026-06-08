/**
 * vendor.ts — `rawscript vendor`: copy the runtime assets into the project so
 * a page can be fully self-hosted (roadmap section 19):
 *
 *   rawscript vendor --dir rawscript
 *
 * Copies rawscript.js + rawscript-sw.js from the installed `rawscript` package.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export interface VendorResult {
  dir: string
  files: string[]
  missing: string[]
}

export async function vendor(dir: string): Promise<VendorResult> {
  const outDir = path.resolve(dir)
  fs.mkdirSync(outDir, { recursive: true })

  const pkgPath = require.resolve('rawscript/package.json')
  const runtimeDist = path.join(path.dirname(pkgPath), 'dist')

  const files: string[] = []
  const missing: string[] = []

  for (const name of ['rawscript.js', 'rawscript-sw.js']) {
    const src = path.join(runtimeDist, name)
    const dest = path.join(outDir, name)
    if (!fs.existsSync(src)) {
      console.warn(`rawscript: runtime asset ${name} not found in ${runtimeDist}`)
      missing.push(name)
      continue
    }
    fs.copyFileSync(src, dest)
    files.push(dest)
  }

  return { dir: outDir, files, missing }
}
