// src/config.ts
var DEFAULT_WASM_URL = "https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm";
var DEFAULT_ESBUILD_URL = "https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js";

// src/transpiler.ts
var WASM_URL = DEFAULT_WASM_URL;
var WASM_CACHE = "rawscript-wasm-v1";
var ESBUILD_VERSION = /esbuild-wasm@([^/]+)\//.exec(WASM_URL)?.[1] ?? "unknown";
function effectiveWasmUrl(config) {
  return config?.wasmUrl ?? DEFAULT_WASM_URL;
}
async function initializeFromCache(esbuild2, wasmUrl) {
  if (typeof caches === "undefined")
    return false;
  let cache = null;
  try {
    cache = await caches.open(WASM_CACHE);
    let cached = await cache.match(wasmUrl);
    if (!cached) {
      const response = await fetch(wasmUrl);
      if (!response.ok)
        return false;
      const bytes = await response.arrayBuffer();
      try {
        await cache.put(wasmUrl, new Response(bytes, { headers: { "Content-Type": "application/wasm" } }));
      } catch {
      }
      cached = new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
    }
    const module = await WebAssembly.compile(await cached.arrayBuffer());
    await esbuild2.initialize({ wasmModule: module, worker: false });
    return true;
  } catch (err) {
    console.warn("rawscript: failed to initialize esbuild from cached WASM, deleting entry and falling back to network", err);
    try {
      await cache?.delete(wasmUrl);
    } catch {
    }
    return false;
  }
}
var initState = /* @__PURE__ */ new Map();
async function ensureInitialized(shim, config) {
  const wasmUrl = effectiveWasmUrl(config);
  const existing = initState.get(shim);
  if (existing && existing.wasmUrl === wasmUrl)
    return existing.promise;
  if (existing && existing.wasmUrl !== wasmUrl) {
    console.warn(
      `rawscript: compiler WASM URL changed mid-life (${existing.wasmUrl} \u2192 ${wasmUrl}); keeping the first initialization until the next page load`
    );
    return existing.promise;
  }
  const promise = (async () => {
    if (!await initializeFromCache(shim, wasmUrl)) {
      await shim.initialize({ wasmURL: wasmUrl, worker: false });
    }
  })().catch((err) => {
    initState.delete(shim);
    throw err;
  });
  initState.set(shim, { promise, wasmUrl });
  return promise;
}
function runTransform(shim, source, filename, jsxConfig) {
  const loader = filename.endsWith(".tsx") ? "tsx" : "ts";
  return shim.transform(source, {
    loader,
    format: "esm",
    target: "esnext",
    sourcefile: filename,
    sourcemap: "inline",
    ...jsxConfig
  }).then((result) => result.code);
}
async function transpileWith(shim, source, filename, jsxConfig = {}, config) {
  await ensureInitialized(shim, config);
  return runTransform(shim, source, filename, jsxConfig);
}

// src/sw.ts
import * as esbuild from "https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js";

// src/resolver.ts
var IMPORT_RE = /\bfrom\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\1|import\s*\(\s*(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\3\s*\)|import\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\5/g;
var ANY_IMPORT_RE = /\bfrom\s+(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)|import\s+(['"])([^'"]+)\5/g;
var ESM_SH = "https://esm.sh/";
var UNRESOLVED_PREFIX = "/__rawscript/unresolved/";
function unresolvedImportUrl(specifier) {
  return UNRESOLVED_PREFIX + encodeURIComponent(specifier);
}
var STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
function isBareSpecifier(specifier) {
  if (specifier.startsWith("https://") || specifier.startsWith("http://") || specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return false;
  }
  return true;
}
function isInsideAnyString(spans, pos) {
  return spans.some((s) => s.start < pos && pos < s.end);
}
function tokenBefore(js, pos) {
  let i = pos - 1;
  while (i >= 0) {
    const ch = js[i];
    if (/\s/.test(ch)) {
      i--;
      continue;
    }
    if (ch === "/" && js[i - 1] === "*") {
      let k = i - 2;
      while (k >= 0 && !(js[k] === "/" && js[k + 1] === "*"))
        k--;
      if (k >= 0) {
        i = k - 1;
        continue;
      }
    }
    break;
  }
  if (i < 0)
    return null;
  if (/[A-Za-z0-9_$]/.test(js[i])) {
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(js[j]))
      j--;
    return { token: js.slice(j + 1, i + 1), tokenPos: j + 1 };
  }
  return { token: js[i], tokenPos: i };
}
function isImportContext(js, stringStart, spans) {
  const before = tokenBefore(js, stringStart);
  if (!before || isInsideAnyString(spans, before.tokenPos))
    return false;
  if (before.token === "from" || before.token === "import")
    return true;
  if (before.token === "(") {
    const beforeParen = tokenBefore(js, before.tokenPos);
    return beforeParen !== null && beforeParen.token === "import" && !isInsideAnyString(spans, beforeParen.tokenPos);
  }
  return false;
}
function blankNonImportStrings(js) {
  const spans = [];
  const keptSpans = [];
  let match;
  STRING_RE.lastIndex = 0;
  while ((match = STRING_RE.exec(js)) !== null) {
    const start = match.index;
    const end = STRING_RE.lastIndex;
    spans.push({ start, end });
    if (isImportContext(js, start, spans)) {
      keptSpans.push({ start, end });
    }
  }
  let blanked = "";
  let cursor = 0;
  for (const { start, end } of spans) {
    blanked += js.slice(cursor, start);
    if (keptSpans.some((k) => k.start === start)) {
      blanked += js.slice(start, end);
    } else {
      blanked += " ".repeat(end - start);
    }
    cursor = end;
  }
  blanked += js.slice(cursor);
  return { blanked, keptSpans };
}
function neutralizeLineComments(js) {
  return js.replace(/\/\/.*$/gm, (match) => " ".repeat(match.length));
}
function mapBareImports(js, mapper) {
  const { blanked } = blankNonImportStrings(js);
  const cleaned = neutralizeLineComments(blanked);
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
    const replacement = mapper(specifier);
    if (replacement === null || replacement === specifier)
      continue;
    const fullMatch = match[0];
    const specStart = fullMatch.indexOf(quote + specifier + quote);
    if (specStart === -1)
      continue;
    const absStart = match.index + specStart + 1;
    const absEnd = absStart + specifier.length;
    replacements.push({ start: absStart, end: absEnd, replacement });
  }
  let result = js;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }
  return result;
}
function rewriteImports(js, importmap, cdn = {}) {
  const map = importmap ?? {};
  const cdnOptions = { enabled: true, base: ESM_SH, ...cdn };
  return mapBareImports(js, (specifier) => {
    if (specifier in map)
      return null;
    if (!cdnOptions.enabled)
      return unresolvedImportUrl(specifier);
    return cdnOptions.base + specifier;
  });
}
function collectImportSpecifiers(js) {
  const { blanked } = blankNonImportStrings(js);
  const cleaned = neutralizeLineComments(blanked);
  const out = [];
  let match;
  ANY_IMPORT_RE.lastIndex = 0;
  while ((match = ANY_IMPORT_RE.exec(cleaned)) !== null) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier)
      out.push(specifier);
  }
  return out;
}

// src/hash.ts
function fnv1a(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// src/version.ts
var RAWSCRIPT_VERSION = "0.2.0";
var SW_PROTOCOL_VERSION = 1;

// src/diagnostics.ts
function extractErrorLocation(message) {
  const match = message.match(/:(\d+):(\d+):/);
  if (match) {
    return { line: parseInt(match[1], 10), column: parseInt(match[2], 10) };
  }
  return { line: 0, column: 0 };
}
function classifyError(message) {
  if (/JSX|jsx/.test(message))
    return "JSX configuration error";
  if (/Could not resolve|not resolved|not be resolved|does not provide an export/.test(message)) {
    return "Module resolution error";
  }
  if (/Syntax error|Expected|Unexpected|Parse|Missing/.test(message))
    return "Syntax error";
  if (/No matching export|does not provide an export|no exported member/.test(message)) {
    return "Import error";
  }
  if (/Transform failed|Failed to build/.test(message))
    return "Compilation error";
  return "Compilation error";
}
function fixForError(message) {
  if (/JSX syntax extension is not currently enabled|jsx/i.test(message) && !/jsxImportSource/.test(message)) {
    return 'JSX was found in a file that is not being transpiled with JSX enabled. Rename the file to .tsx, or configure JSX in tsconfig.json (jsx: "react-jsx", optionally with jsxImportSource for Preact/Solid).';
  }
  if (/Could not resolve|not resolved|not be resolved/.test(message)) {
    return 'A bare import could not be resolved. Add it to the importmap in your HTML (e.g. "react": "https://esm.sh/react@18.3.1"), or check that a relative path points at an existing file.';
  }
  if (/does not provide an export|No matching export|no exported member/i.test(message)) {
    return "The imported name is not exported by the target module. Check the export list of the imported file, or remove the named import.";
  }
  if (/Syntax error|Expected|Unexpected|Missing/i.test(message)) {
    return "Look at the marked line: a bracket, brace, parenthesis, quote, or semicolon is missing or duplicated. If the error is in generated code, the original source is shown by the code frame above.";
  }
  return "Inspect the code frame above and fix the reported line. If the error repeats, run `rawscript typecheck` for the full compiler diagnostic list.";
}
function codeFrame(source, line, column) {
  if (line < 1)
    return "";
  const lines = source.split("\n");
  const start = Math.max(0, line - 4);
  const end = Math.min(lines.length, line + 3);
  const gutter = String(end).length;
  let frame = "";
  for (let i = start; i < end; i++) {
    const marker = i === line - 1 ? ">" : " ";
    frame += `${marker} ${String(i + 1).padStart(gutter)} \u2502 ${lines[i] ?? ""}
`;
    if (i === line - 1) {
      frame += `${marker} ${" ".repeat(gutter)} \u2502 ${" ".repeat(Math.max(0, column - 1))}^
`;
    }
  }
  return frame;
}
function buildCompileDiagnostic(input) {
  const { line, column } = extractErrorLocation(input.message);
  const detail = input.message.split("\n").filter((l) => l.trim().length > 0).slice(0, 6).join("\n");
  return {
    file: input.file,
    line,
    column,
    category: classifyError(input.message),
    message: input.message.split("\n")[0] ?? input.message,
    detail,
    fix: fixForError(input.message),
    frame: input.source ? codeFrame(input.source, line, column) : "",
    chain: input.chain ?? [input.file]
  };
}

// src/tsconfig.ts
var TSCONFIG_TTL_MS = 5e3;
var cachedState = null;
function parseTsConfig(text, dir = "") {
  let raw;
  try {
    raw = JSON.parse(stripJsonComments(text));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`tsconfig.json is not valid JSON: ${detail}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tsconfig.json must contain an object");
  }
  const record = raw;
  const compilerOptions = record.compilerOptions !== void 0 && typeof record.compilerOptions === "object" && !Array.isArray(record.compilerOptions) ? record.compilerOptions : {};
  return { raw: record, compilerOptions, dir };
}
async function fetchTsConfig(requestPathname) {
  const now = Date.now();
  if (cachedState && now - cachedState.at < TSCONFIG_TTL_MS) {
    return cachedState.tsconfig;
  }
  let result = null;
  try {
    const origin = new URL(self.location.origin);
    const moduleDir = requestPathname.slice(0, requestPathname.lastIndexOf("/"));
    const candidates = ["/tsconfig.json", joinUrlPath(moduleDir, "tsconfig.json")];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate))
        continue;
      seen.add(candidate);
      const url = new URL(candidate, origin).href;
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404)
        continue;
      if (!response.ok)
        continue;
      const dir = candidate.slice(0, candidate.lastIndexOf("/"));
      result = parseTsConfig(await response.text(), dir);
      break;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read tsconfig.json: ${detail}`);
  }
  cachedState = { tsconfig: result, at: now };
  return result;
}
function getJsxOptionsFromTsconfig(tsconfig) {
  if (!tsconfig)
    return null;
  const co = tsconfig.compilerOptions;
  const jsx = co.jsx;
  const jsxImportSource = typeof co.jsxImportSource === "string" ? co.jsxImportSource : void 0;
  const jsxFactory = typeof co.jsxFactory === "string" ? co.jsxFactory : void 0;
  const jsxFragment = typeof co.jsxFragmentFactory === "string" ? co.jsxFragmentFactory : void 0;
  if (jsx === void 0 && jsxImportSource === void 0 && jsxFactory === void 0 && jsxFragment === void 0) {
    return null;
  }
  if (jsx === "react-jsx") {
    return { jsx: "automatic", jsxImportSource: jsxImportSource ?? "react" };
  }
  if (jsx === "react-jsxdev") {
    return { jsx: "automatic", jsxImportSource: jsxImportSource ?? "react", jsxDev: true };
  }
  if (jsx === "react") {
    return { jsx: "transform", jsxFactory, jsxFragment };
  }
  if (jsx === "preserve") {
    return { jsx: "preserve" };
  }
  return { jsx: "automatic", jsxImportSource: jsxImportSource ?? "react" };
}
var KNOWN_JSX_VALUES = ["react-jsx", "react-jsxdev", "react", "preserve"];
var NON_ESM_MODULES = ["commonjs", "amd", "umd", "system"];
function unsupportedOptionWarnings(tsconfig) {
  if (!tsconfig)
    return [];
  const co = tsconfig.compilerOptions;
  const warnings = [];
  if (co.verbatimModuleSyntax === true) {
    warnings.push({
      option: "verbatimModuleSyntax",
      message: "verbatimModuleSyntax is not supported by the bundled esbuild (0.20.2); type-only imports are always elided. Remove the option or upgrade the esbuild version."
    });
  }
  if (co.importsNotUsedAsValues === "preserve") {
    warnings.push({
      option: "importsNotUsedAsValues",
      message: "importsNotUsedAsValues is not supported by the bundled esbuild (0.20.2); type-only imports are always elided. Use verbatimModuleSyntax (once supported) or remove the option."
    });
  }
  if (typeof co.module === "string" && NON_ESM_MODULES.includes(co.module)) {
    warnings.push({
      option: "module",
      message: `module: "${co.module}" is ignored; Rawscript output is always ESM. Remove the option or set module to "esnext" / "es2022".`
    });
  }
  if (typeof co.moduleResolution === "string" && co.moduleResolution !== "classic" && co.moduleResolution !== "bundler" && co.moduleResolution !== "node" && co.moduleResolution !== "node10") {
    warnings.push({
      option: "moduleResolution",
      message: `moduleResolution: "${co.moduleResolution}" is not used by the browser runtime; module resolution uses import maps, tsconfig paths/baseUrl, and CDN fallback. The setting still applies when you run \`rawscript typecheck\`.`
    });
  }
  if (co.jsx === "preserve") {
    warnings.push({
      option: "jsx",
      message: 'jsx: "preserve" leaves JSX untransformed, which browsers cannot execute. Use "react-jsx" (or "react-jsxdev" in development) or "react".'
    });
  }
  if (co.jsx !== void 0 && typeof co.jsx === "string" && !KNOWN_JSX_VALUES.includes(co.jsx)) {
    warnings.push({
      option: "jsx",
      message: `jsx: "${co.jsx}" is not a recognized value; using the automatic runtime instead. Supported values: react-jsx, react-jsxdev, react, preserve.`
    });
  }
  return warnings;
}
function readPaths(tsconfig) {
  const paths = tsconfig.compilerOptions.paths;
  if (paths === null || paths === void 0 || typeof paths !== "object" || Array.isArray(paths)) {
    return null;
  }
  const out = {};
  for (const [pattern, targets] of Object.entries(paths)) {
    if (Array.isArray(targets)) {
      out[pattern] = targets.map((t) => String(t));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
function applyPaths(specifier, tsconfig, importerPathname) {
  const paths = readPaths(tsconfig);
  if (!paths)
    return null;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (targets.length === 0)
      continue;
    const star = pattern.indexOf("*");
    let wildcard = null;
    if (star === -1) {
      if (pattern === specifier)
        wildcard = "";
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
        wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      }
    }
    if (wildcard === null)
      continue;
    let target = targets[0];
    const targetStar = target.indexOf("*");
    if (targetStar !== -1) {
      target = target.slice(0, targetStar) + wildcard + target.slice(targetStar + 1);
    }
    if (!/\.[^/]+$/.test(target)) {
      target += ".ts";
    }
    const base = tsconfig.dir;
    const baseUrl = typeof tsconfig.compilerOptions.baseUrl === "string" ? tsconfig.compilerOptions.baseUrl : "";
    const resolved = joinUrlPath(baseUrl ? joinUrlPath(base, baseUrl) : base, target);
    const importerDir = importerPathname.slice(0, importerPathname.lastIndexOf("/"));
    const relative = relativeUrlPath(importerDir, resolved);
    return relative.startsWith(".") ? relative : "./" + relative;
  }
  return null;
}
function joinUrlPath(base, rel) {
  if (rel.startsWith("/"))
    return rel;
  const stack = base.split("/").filter(Boolean);
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".")
      continue;
    if (segment === "..") {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return "/" + stack.join("/");
}
function relativeUrlPath(from, to) {
  const f = from.split("/").filter(Boolean);
  const t = to.split("/").filter(Boolean);
  let common = 0;
  while (common < f.length && common < t.length && f[common] === t[common])
    common++;
  const ups = f.length - common;
  const downs = t.slice(common);
  const parts = [...Array.from({ length: ups }, () => ".."), ...downs];
  return parts.length === 0 ? "." : parts.join("/");
}
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === '"')
        inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n")
        i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// src/sw.ts
var TRANSPILED_CACHE = "rawscript-transpiled-v2";
var META_CACHE = "rawscript-meta-v1";
var DEPENDENCY_CACHE = "rawscript-deps-v1";
var META_KEY = "rawscript://meta";
var FINGERPRINT_HEADER = "x-rawscript-fingerprint";
var BODY_HASH_HEADER = "x-rawscript-body-hash";
var TARGET = "esnext";
var FORMAT = "esm";
var knownImportmap = {};
var knownConfig = {};
var configState = null;
var CONFIG_TTL_MS = 5e3;
var moduleGraph = /* @__PURE__ */ new Map();
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(WASM_CACHE).then((cache) => cache.add(WASM_URL)).catch(
        (err) => console.warn("rawscript: WASM pre-cache failed; it will be fetched on demand", err)
      ),
      // Warm the browser HTTP cache for the default esbuild-wasm shim so an
      // offline reload can re-import it without the network. (Cache Storage
      // does not feed dynamic import(); the HTTP cache does.)
      fetch(DEFAULT_ESBUILD_URL).then((response) => response.arrayBuffer()).catch(
        (err) => console.warn("rawscript: esbuild shim pre-warm failed; it will be fetched on demand", err)
      )
    ])
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});
async function activate() {
  await self.clients.claim();
  const oldMeta = await readMeta();
  const names = (await caches.keys()).filter((name) => name.startsWith("rawscript-"));
  if (oldMeta && oldMeta.protocolVersion !== SW_PROTOCOL_VERSION) {
    console.warn("rawscript: protocol version changed, resetting all caches");
    await Promise.all(names.map((name) => caches.delete(name)));
  } else {
    await Promise.all(
      names.filter(
        (name) => name !== WASM_CACHE && name !== TRANSPILED_CACHE && name !== META_CACHE && name !== DEPENDENCY_CACHE
      ).map((name) => caches.delete(name))
    );
  }
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(
      META_KEY,
      new Response(JSON.stringify({ protocolVersion: SW_PROTOCOL_VERSION, rawscriptVersion: RAWSCRIPT_VERSION }), {
        headers: { "Content-Type": "application/json" }
      })
    );
  } catch (err) {
    console.warn("rawscript: failed to write version metadata", err);
  }
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({
      type: "SW_ACTIVATED",
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION
    });
  }
}
async function readMeta() {
  try {
    const cache = await caches.open(META_CACHE);
    const hit = await cache.match(META_KEY);
    if (!hit)
      return null;
    return await hit.json();
  } catch {
    return null;
  }
}
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object")
    return;
  if (data.type === "HANDSHAKE") {
    knownImportmap = data.importmap ?? {};
    const config = data.config;
    knownConfig = config && typeof config === "object" ? config : {};
    if (knownConfig.esbuildUrl) {
      fetch(knownConfig.esbuildUrl).then((response) => response.arrayBuffer()).catch(() => {
      });
    }
    if (knownConfig.wasmUrl) {
      caches.open(WASM_CACHE).then((cache) => cache.add(knownConfig.wasmUrl)).catch(() => {
      });
    }
    event.ports?.[0]?.postMessage({
      type: "SW_READY",
      protocolVersion: SW_PROTOCOL_VERSION,
      rawscriptVersion: RAWSCRIPT_VERSION
    });
  } else if (data.type === "IMPORTMAP") {
    knownImportmap = data.importmap ?? {};
  } else if (data.type === "CACHE_BUST") {
    event.waitUntil(
      bustCache(data.url).then(() => {
        event.ports?.[0]?.postMessage({ type: "CACHE_BUSTED" });
      })
    );
  }
});
async function bustCache(url) {
  const cache = await caches.open(TRANSPILED_CACHE);
  if (url) {
    await cache.delete(url);
  } else {
    const keys = await cache.keys();
    await Promise.all(keys.map((key) => cache.delete(key)));
  }
}
function getJsxConfig() {
  if (knownImportmap["solid-js"]) {
    return { jsx: "automatic", jsxImportSource: "solid-js/h" };
  }
  if ((knownImportmap["react"] ?? "").includes("preact")) {
    return { jsx: "automatic", jsxImportSource: "preact/compat" };
  }
  return { jsx: "automatic", jsxImportSource: "react" };
}
async function getTsconfigState(pathname) {
  const now = Date.now();
  if (configState && now - configState.at < CONFIG_TTL_MS) {
    const jsxConfig2 = getJsxOptionsFromTsconfig(configState.tsconfig) ?? getJsxConfig();
    return { tsconfig: configState.tsconfig, jsxConfig: jsxConfig2 };
  }
  let tsconfig = null;
  try {
    tsconfig = await fetchTsConfig(pathname);
    for (const warning of unsupportedOptionWarnings(tsconfig)) {
      notifyClient({ type: "CONFIG_WARNING", option: warning.option, message: warning.message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notifyClient({ type: "CONFIG_ERROR", file: "/tsconfig.json", message });
  }
  configState = { tsconfig, at: now };
  const jsxConfig = getJsxOptionsFromTsconfig(tsconfig) ?? getJsxConfig();
  return { tsconfig, jsxConfig };
}
async function handleFetch(event) {
  const url = new URL(event.request.url);
  const isGet = event.request.method === "GET";
  if (isGet && isDependencyRequest(event.request, knownImportmap)) {
    const depsCache = await caches.open(DEPENDENCY_CACHE);
    const cachedDep = await depsCache.match(event.request);
    if (cachedDep)
      return cachedDep;
    const depResponse = await fetch(event.request);
    if (depResponse.ok) {
      try {
        await depsCache.put(event.request, depResponse.clone());
      } catch (err) {
        console.warn("rawscript: failed to cache dependency", event.request.url, err);
      }
    }
    return depResponse;
  }
  if (isGet && url.pathname.startsWith(UNRESOLVED_PREFIX)) {
    const specifier = decodeURIComponent(url.pathname.slice(UNRESOLVED_PREFIX.length));
    const diagnostic = buildCompileDiagnostic({
      file: specifier,
      message: `could not be resolved: no import map entry and CDN fallback is disabled`,
      chain: getImportChain(url.pathname)
    });
    notifyClient({ type: "TRANSPILE_ERROR", ...diagnostic });
    return transpileErrorResponse(diagnostic);
  }
  const isTs = isGet && (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx"));
  if (!isTs)
    return fetch(event.request);
  let source;
  let fetched;
  try {
    fetched = await fetch(event.request, { cache: "no-store" });
  } catch (err) {
    const cache2 = await caches.open(TRANSPILED_CACHE);
    const stale = await cache2.match(event.request);
    if (stale) {
      console.warn(`rawscript: network error fetching ${url.pathname}, serving stale cache`, err);
      return stale;
    }
    return new Response(`rawscript: network error fetching ${url.pathname}`, { status: 502 });
  }
  if (!fetched.ok) {
    return fetched;
  }
  source = await fetched.text();
  const { tsconfig, jsxConfig } = await getTsconfigState(url.pathname);
  const fingerprint = fnv1a(
    JSON.stringify({
      source,
      jsxConfig,
      importmap: knownImportmap,
      tsconfig: tsconfig?.raw ?? null,
      esbuild: ESBUILD_VERSION,
      esbuildUrl: knownConfig.esbuildUrl ?? null,
      wasmUrl: knownConfig.wasmUrl ?? null,
      cdn: knownConfig.cdn ?? null,
      rawscript: RAWSCRIPT_VERSION,
      target: TARGET,
      format: FORMAT
    })
  );
  const cache = await caches.open(TRANSPILED_CACHE);
  const cached = await cache.match(event.request);
  if (cached) {
    if (cached.headers.get(FINGERPRINT_HEADER) === fingerprint) {
      const valid = await isBodyIntact(cached);
      if (valid)
        return cached;
      console.warn(`rawscript: cache entry for ${url.pathname} failed integrity check, recompiling`);
      await cache.delete(event.request);
    } else {
      await cache.delete(event.request);
    }
  }
  try {
    let toTranspile = source;
    if (tsconfig) {
      const mapped = mapBareImports(source, (specifier) => {
        if (specifier in knownImportmap)
          return null;
        return applyPaths(specifier, tsconfig, url.pathname);
      });
      if (mapped !== source)
        toTranspile = mapped;
    }
    recordModuleGraph(url.pathname, source);
    const js = await transpileWith(
      esbuild,
      toTranspile,
      url.pathname,
      jsxConfig,
      knownConfig
    );
    const rewritten = rewriteImports(js, knownImportmap, knownConfig.cdn);
    const out = new Response(rewritten, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        [FINGERPRINT_HEADER]: fingerprint,
        [BODY_HASH_HEADER]: fnv1a(rewritten)
      }
    });
    try {
      await cache.put(event.request, out.clone());
    } catch (err) {
      console.warn(`rawscript: failed to cache ${url.pathname}, serving without caching`, err);
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnostic = buildCompileDiagnostic({
      file: url.pathname,
      message,
      source,
      chain: getImportChain(url.pathname)
    });
    notifyClient({ type: "TRANSPILE_ERROR", ...diagnostic });
    return transpileErrorResponse(diagnostic);
  }
}
async function isBodyIntact(cached) {
  try {
    const expected = cached.headers.get(BODY_HASH_HEADER);
    if (!expected)
      return false;
    const body = await cached.clone().text();
    return fnv1a(body) === expected;
  } catch {
    return false;
  }
}
function recordModuleGraph(modulePath, rewritten) {
  if (moduleGraph.size > 2e4)
    moduleGraph.clear();
  const imports = collectImportSpecifiers(rewritten);
  for (const spec of imports) {
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const imported = new URL(spec, new URL(modulePath, self.location.origin));
      moduleGraph.set(imported.pathname, modulePath);
    }
  }
}
function getImportChain(file) {
  const chain = [file];
  let current = file;
  let depth = 0;
  while (depth < 50) {
    const importer = moduleGraph.get(current);
    if (!importer)
      break;
    chain.unshift(importer);
    current = importer;
    depth++;
  }
  return chain;
}
function notifyClient(data) {
  self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) {
      client.postMessage(data);
    }
  });
}
function isDependencyRequest(request, importmap) {
  const url = new URL(request.url);
  if (url.pathname.endsWith(".ts") || url.pathname.endsWith(".tsx"))
    return false;
  if (url.origin !== self.location.origin)
    return true;
  for (const value of Object.values(importmap)) {
    if (value === request.url)
      return true;
  }
  return false;
}
function transpileErrorResponse(diagnostic) {
  const safe = diagnostic.message.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  const js = `throw new Error("rawscript: ${diagnostic.category} in ${diagnostic.file}: ${safe}")`;
  return new Response(js, {
    headers: { "Content-Type": "application/javascript; charset=utf-8" }
  });
}
self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});
