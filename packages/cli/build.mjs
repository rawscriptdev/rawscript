/**
 * packages/cli/build.mjs — bundles the CLI into a single executable ESM file.
 */
import * as esbuild from 'esbuild'
import { mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(path.join(here, 'dist'), { recursive: true })

await esbuild.build({
  entryPoints: [path.join(here, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: path.join(here, 'dist/cli.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  external: ['esbuild', 'commander', 'typescript', 'rawscript'],
})

console.log('✓ CLI built to dist/cli.mjs')
