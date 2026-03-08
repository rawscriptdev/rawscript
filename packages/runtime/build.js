// packages/runtime/build.js
// Plain JS — runs with Node without compilation
import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

// Build rawscript.js (main thread boot script — IIFE, self-executing)
await esbuild.build({
  entryPoints: ['src/boot.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/rawscript.js',
  platform: 'browser',
  target: 'es2022',
  minify: false, // readable for v0.1.0, minify in v0.9.0
})

// Build rawscript-sw.js (Service Worker — ESM format)
// bundle: true so transpiler.ts is inlined, but CDN imports stay external
await esbuild.build({
  entryPoints: ['src/sw.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/rawscript-sw.js',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  external: ['https://unpkg.com/*'],
})

// Copy dist files to repo root so examples work when served from project root
// /dist/rawscript.js  — referenced by <script src="/dist/rawscript.js">
// /rawscript-sw.js    — SW must be at root for scope to cover all routes
const repoRoot = '../../'
mkdirSync(repoRoot + 'dist', { recursive: true })
cpSync('dist/rawscript.js', repoRoot + 'dist/rawscript.js')
cpSync('dist/rawscript-sw.js', repoRoot + 'rawscript-sw.js')

console.log('✓ rawscript built to dist/')
console.log('✓ copied to repo root for local dev')
