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
  const loader = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = await esbuild.transform(source, {
    loader,
    format: "esm",
    target: "esnext",
    sourcefile: filename,
    sourcemap: "inline"
  });
  return result.code;
}

// src/resolver.ts
var IMPORT_RE = /\bfrom\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\1|import\s*\(\s*(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\3\s*\)|import\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\5/g;
var ESM_SH = "https://esm.sh/";
function isBareSpecifier(specifier) {
  if (specifier.startsWith("https://") || specifier.startsWith("http://") || specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return false;
  }
  return true;
}
function neutralizeLineComments(js) {
  return js.replace(/\/\/.*$/gm, (match) => " ".repeat(match.length));
}
function rewriteImports(js, importmap) {
  const map = importmap ?? {};
  const cleaned = neutralizeLineComments(js);
  const replacements = [];
  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(cleaned)) !== null) {
    const specifier = match[2] ?? match[4] ?? match[6];
    const quote = match[1] ?? match[3] ?? match[5];
    if (!specifier)
      continue;
    if (!isBareSpecifier(specifier))
      continue;
    if (specifier in map)
      continue;
    const rewritten = ESM_SH + specifier;
    const fullMatch = match[0];
    const specStart = fullMatch.indexOf(quote + specifier + quote);
    if (specStart === -1)
      continue;
    const absStart = match.index + specStart + 1;
    const absEnd = absStart + specifier.length;
    replacements.push({ start: absStart, end: absEnd, replacement: rewritten });
  }
  let result = js;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }
  return result;
}

// src/sw.ts
var knownImportmap = {};
self.addEventListener("message", (event) => {
  if (event.data?.type === "IMPORTMAP") {
    knownImportmap = event.data.importmap ?? {};
  }
});
async function handleFetch(event) {
  const url = new URL(event.request.url);
  if (event.request.method === "GET" && (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx"))) {
    const response = await fetch(event.request);
    if (!response.ok) {
      return response;
    }
    const source = await response.text();
    const js = await transpile(source, url.pathname);
    const rewritten = rewriteImports(js, knownImportmap);
    return new Response(rewritten, {
      headers: { "Content-Type": "application/javascript; charset=utf-8" }
    });
  }
  return fetch(event.request);
}
self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});
