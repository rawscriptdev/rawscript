/**
 * Ambient type declarations for the esbuild-wasm ESM bundle loaded
 * dynamically from a URL (unpkg by default, or a self-hosted copy via
 * `window.rawscriptConfig.esbuildUrl`).
 *
 * Pinned to esbuild-wasm 0.20.2 — bump the URL and this declaration together.
 */
declare module 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js' {
  export interface InitializeOptions {
    wasmURL?: string | URL
    wasmModule?: WebAssembly.Module
    worker?: boolean
    [key: string]: unknown
  }

  export interface TransformOptions {
    loader?: 'js' | 'jsx' | 'ts' | 'tsx' | 'css' | 'json' | 'text' | 'base64' | 'file' | 'dataurl'
    format?: 'iife' | 'cjs' | 'esm'
    target?: string | string[]
    sourcefile?: string
    sourcemap?: boolean | 'inline' | 'external' | 'both'
    minify?: boolean
    jsx?: 'transform' | 'preserve' | 'automatic'
    jsxFactory?: string
    jsxFragment?: string
    jsxImportSource?: string
    tsconfigRaw?: string | Record<string, unknown>
    [key: string]: unknown
  }

  export interface TransformResult {
    code: string
    map?: string
    warnings?: Array<{ text: string; location?: unknown }>
  }

  export function initialize(options?: InitializeOptions): Promise<void>
  export function transform(
    input: string | Uint8Array,
    options?: TransformOptions
  ): Promise<TransformResult>
  export const version: string
}
