import * as esbuild from 'https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js'

let initPromise: Promise<void> | null = null

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = esbuild.initialize({
      wasmURL: 'https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm',
      worker: false,
    })
  }
  await initPromise
}

export async function transpile(source: string, filename: string): Promise<string> {
  await ensureInitialized()
  const result = await esbuild.transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'esnext',
    sourcefile: filename,
    sourcemap: 'inline',
  })
  return result.code
}
