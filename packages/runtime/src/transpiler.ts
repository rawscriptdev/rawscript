import * as esbuild from 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'

export const WASM_URL = 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm'
export const WASM_CACHE = 'rawscript-wasm-v1'
export const ESBUILD_VERSION = /esbuild-wasm@([^/]+)\//.exec(WASM_URL)?.[1] ?? 'unknown'

let initPromise: Promise<void> | null = null

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({
      wasmURL: WASM_URL,
      worker: false,
    })
  }
  await initPromise
}

export interface JsxConfig {
  jsx?: 'transform' | 'automatic' | 'preserve'
  jsxFactory?: string
  jsxFragment?: string
  jsxImportSource?: string
  jsxDev?: boolean
}

export async function transpile(
  source: string,
  filename: string,
  jsxConfig: JsxConfig = {}
): Promise<string> {
  await ensureInitialized()
  const loader = filename.endsWith('.tsx') ? 'tsx' : 'ts'
  const result = await esbuild.transform(source, {
    loader,
    format: 'esm',
    target: 'esnext',
    sourcefile: filename,
    sourcemap: 'inline',
    ...jsxConfig,
  })
  return result.code
}