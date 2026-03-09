// src/transpiler.ts
import * as esbuild from "https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js";
var initPromise = null;
async function ensureInitialized() {
  if (!initPromise) {
    initPromise = esbuild.initialize({
      wasmURL: "https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm",
      worker: false
    });
  }
  await initPromise;
}
async function transpile(source, filename) {
  await ensureInitialized();
  const result = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
    target: "esnext",
    sourcefile: filename,
    sourcemap: "inline"
  });
  return result.code;
}

// src/sw.ts
async function handleFetch(event) {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx"))) {
    const response = await fetch(event.request);
    if (!response.ok) {
      return response;
    }
    const source = await response.text();
    const transpiled = await transpile(source, url.pathname);
    return new Response(transpiled, {
      headers: { "Content-Type": "application/javascript" }
    });
  }
  return fetch(event.request);
}
self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});
