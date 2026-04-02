"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined")
      return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/transpiler.ts
  var transpiler_exports = {};
  __export(transpiler_exports, {
    ESBUILD_VERSION: () => ESBUILD_VERSION,
    WASM_CACHE: () => WASM_CACHE,
    WASM_URL: () => WASM_URL,
    transpile: () => transpile
  });
  async function initializeFromCache() {
    if (typeof caches === "undefined")
      return false;
    let cache = null;
    try {
      cache = await caches.open(WASM_CACHE);
      const cached = await cache.match(WASM_URL);
      if (!cached)
        return false;
      const module = await WebAssembly.compile(await cached.arrayBuffer());
      await esbuild.initialize({ wasmModule: module, worker: false });
      return true;
    } catch (err) {
      console.warn("rawscript: failed to initialize esbuild from cached WASM, deleting entry and falling back to network", err);
      try {
        await cache?.delete(WASM_URL);
      } catch {
      }
      return false;
    }
  }
  async function ensureInitialized() {
    if (!initPromise) {
      initPromise = (async () => {
        if (!await initializeFromCache()) {
          await esbuild.initialize({ wasmURL: WASM_URL, worker: false });
        }
      })();
    }
    await initPromise;
  }
  async function transpile(source, filename, jsxConfig = {}) {
    await ensureInitialized();
    const loader = filename.endsWith(".tsx") ? "tsx" : "ts";
    const result = await esbuild.transform(source, {
      loader,
      format: "esm",
      target: "esnext",
      sourcefile: filename,
      sourcemap: "inline",
      ...jsxConfig
    });
    return result.code;
  }
  var esbuild, WASM_URL, WASM_CACHE, ESBUILD_VERSION, initPromise;
  var init_transpiler = __esm({
    "src/transpiler.ts"() {
      "use strict";
      esbuild = __toESM(__require("https://unpkg.com/esbuild-wasm@0.20.2/esm/browser.js"), 1);
      WASM_URL = "https://unpkg.com/esbuild-wasm@0.20.2/esbuild.wasm";
      WASM_CACHE = "rawscript-wasm-v1";
      ESBUILD_VERSION = /esbuild-wasm@([^/]+)\//.exec(WASM_URL)?.[1] ?? "unknown";
      initPromise = null;
    }
  });

  // src/resolver.ts
  var resolver_exports = {};
  __export(resolver_exports, {
    collectImportSpecifiers: () => collectImportSpecifiers,
    mapBareImports: () => mapBareImports,
    rewriteImports: () => rewriteImports
  });
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
  function rewriteImports(js, importmap) {
    const map = importmap ?? {};
    return mapBareImports(js, (specifier) => {
      if (specifier in map)
        return null;
      return ESM_SH + specifier;
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
  var IMPORT_RE, ANY_IMPORT_RE, ESM_SH, STRING_RE;
  var init_resolver = __esm({
    "src/resolver.ts"() {
      "use strict";
      IMPORT_RE = /\bfrom\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\1|import\s*\(\s*(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\3\s*\)|import\s+(['"])((?:@[^/'"]+\/[^'"]+|[^.'"/][^'"]*))\5/g;
      ANY_IMPORT_RE = /\bfrom\s+(['"])([^'"]+)\1|import\s*\(\s*(['"])([^'"]+)\3\s*\)|import\s+(['"])([^'"]+)\5/g;
      ESM_SH = "https://esm.sh/";
      STRING_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
    }
  });

  // src/env.ts
  var env = {
    /** Whether Service Workers are supported in this browser */
    swSupported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    /** Whether ES modules are supported (noModule attribute exists on browsers with module support) */
    esmSupported: typeof document !== "undefined" && "noModule" in document.createElement("script"),
    /** Whether BroadcastChannel is supported */
    broadcastChannelSupported: typeof window !== "undefined" && "BroadcastChannel" in window,
    /** Whether fetch is supported */
    fetchSupported: typeof window !== "undefined" && "fetch" in window,
    /** Whether the Service Worker is currently active */
    isSWActive: false,
    // Set by boot.ts when SW registers successfully
    /** Whether we're in development mode (localhost/127.0.0.1) */
    isDev: typeof window !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.hostname),
    /** Whether hot reload is enabled (dev mode only) */
    isHmrEnabled: false,
    // Set based on data-hmr-interval attribute
    /** SW polling interval in ms, or null if HMR disabled in production */
    hmrInterval: null,
    // Set from data-hmr-attribute
    /** Platform detection */
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    /** Browser user agent (truncated) */
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "unknown"
  };

  // src/loader.ts
  function showLoadingIndicator() {
    if (!env.isDev)
      return;
    const indicator = document.createElement("div");
    indicator.className = "rawscript-loader";
    indicator.style.position = "fixed";
    indicator.style.top = "0";
    indicator.style.left = "0";
    indicator.style.width = "100%";
    indicator.style.height = "100%";
    indicator.style.background = "rgba(255, 255, 255, 0.9)";
    indicator.style.display = "flex";
    indicator.style.alignItems = "center";
    indicator.style.justifyContent = "center";
    indicator.style.zIndex = "9999";
    indicator.style.fontFamily = "system-ui, sans-serif";
    indicator.style.color = "#333";
    indicator.innerHTML = `
    <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
      <div style="font-size: 3rem; margin-bottom: 1rem;">\u26A1</div>
      <div style="font-size: 1.25rem; margin-bottom: 0.5rem;">Rawscript is loading\u2026</div>
      <div style="font-size: 0.875rem; opacity: 0.7;">
        Compiling TypeScript in browser. This may take a few seconds on first load.
      </div>
    </div>
  `;
    document.body.appendChild(indicator);
  }
  function hideLoadingIndicator() {
    const existing = document.querySelector(".rawscript-loader");
    if (existing) {
      existing.remove();
    }
  }

  // src/fallback.ts
  async function runFallback() {
    if (typeof window === "undefined")
      return;
    if ("serviceWorker" in navigator)
      return;
    const tsScripts = document.querySelectorAll(
      'script[type="module"][src$=".ts"], script[type="module"][src$=".tsx"]'
    );
    if (tsScripts.length === 0)
      return;
    const transpiler = await Promise.resolve().then(() => (init_transpiler(), transpiler_exports));
    const resolver = await Promise.resolve().then(() => (init_resolver(), resolver_exports));
    console.warn(
      "rawscript: Service Workers are unavailable \u2014 using the Blob URL fallback. Slower and no cross-load caching."
    );
    const importmap = readImportmap();
    const blobCache = /* @__PURE__ */ new Map();
    const inProgress = /* @__PURE__ */ new Set();
    async function processFile(src, scriptElement) {
      const cached = blobCache.get(src);
      if (cached)
        return cached;
      if (inProgress.has(src))
        return null;
      inProgress.add(src);
      try {
        const source = await fetchSource(src);
        if (source === null)
          return null;
        let js;
        try {
          js = await transpiler.transpile(source, src);
        } catch (err) {
          console.error(`rawscript: fallback failed to transpile ${src}:`, err);
          if (scriptElement)
            scriptElement.style.display = "none";
          return null;
        }
        const rewritten = resolver.rewriteImports(js, importmap);
        const resolved = await resolveRelativeImports(rewritten, src, processFile);
        const blob = new Blob([resolved], { type: "application/javascript; charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        blobCache.set(src, blobUrl);
        if (scriptElement) {
          scriptElement.src = blobUrl;
          scriptElement.setAttribute("type", "module");
        }
        console.log(`rawscript: fallback transpiled ${src} \u2192 ${blobUrl}`);
        return blobUrl;
      } catch (err) {
        console.error(`rawscript: unexpected error processing ${src}:`, err);
        return null;
      } finally {
        inProgress.delete(src);
      }
    }
    for (const script of tsScripts) {
      const src = script.getAttribute("src");
      if (src)
        await processFile(src, script);
    }
    console.info("rawscript: using Blob URL fallback (Service Worker unavailable)");
  }
  function readImportmap() {
    const importmapEl = document.querySelector('script[type="importmap"]');
    if (!importmapEl)
      return {};
    try {
      const importmap = JSON.parse(importmapEl.textContent || "{}");
      return importmap.imports ?? {};
    } catch {
      return {};
    }
  }
  async function fetchSource(src) {
    try {
      const response = await fetch(src);
      if (!response.ok) {
        console.warn(`rawscript: fallback failed to fetch ${src} (${response.status})`);
        return null;
      }
      return await response.text();
    } catch (err) {
      console.warn(`rawscript: fallback error fetching ${src}:`, err);
      return null;
    }
  }
  var RELATIVE_IMPORT_RE = /(from\s+['"]|import\s*\(\s*['"]|import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
  async function resolveRelativeImports(code, sourceUrl, processFile) {
    const replacements = [];
    let match;
    RELATIVE_IMPORT_RE.lastIndex = 0;
    while ((match = RELATIVE_IMPORT_RE.exec(code)) !== null) {
      const specifier = match[2];
      if (!specifier.endsWith(".ts") && !specifier.endsWith(".tsx"))
        continue;
      const resolvedUrl = new URL(specifier, sourceUrl).href;
      const blobUrl = await processFile(resolvedUrl, null);
      if (blobUrl) {
        const start = match.index + match[1].length;
        replacements.push({ start, end: start + specifier.length, replacement: blobUrl });
      }
    }
    let result = code;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
    }
    return result;
  }

  // src/errors.ts
  var ErrorOverlay = class {
    overlay;
    error;
    sourceUrl;
    line;
    column;
    details;
    constructor(error, sourceUrl, line, column, details = null) {
      this.error = error;
      this.sourceUrl = sourceUrl;
      this.line = line;
      this.column = column;
      this.details = details;
      this.overlay = this.createOverlay();
    }
    createOverlay() {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.top = "0";
      overlay.style.left = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.background = "rgba(0, 0, 0, 0.85)";
      overlay.style.color = "#fff";
      overlay.style.fontFamily = "system-ui, sans-serif";
      overlay.style.zIndex = "99999";
      overlay.style.display = "flex";
      overlay.style.flexDirection = "column";
      overlay.style.justifyContent = "center";
      overlay.style.alignItems = "center";
      overlay.style.fontSize = "14px";
      const category = this.details?.category ?? "TypeScript Compilation Error";
      const fix = this.details?.fix;
      const chain = this.details?.chain ?? [];
      overlay.innerHTML = `
      <div style="background: #1a1a2e; padding: 2rem; border-radius: 8px; margin: 1rem; max-width: 800px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <span style="font-size: 2rem; opacity: 0.8;">\u26A0\uFE0F</span>
          <h2 style="margin: 0; font-size: 1.25rem;">${escapeHtml(category)}</h2>
          <button
            style="background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer;"
            aria-label="Dismiss error overlay"
          >
            \xD7
          </button>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0.5rem 0; font-size: 0.875rem;">${escapeHtml(this.error.message)}</p>
          <p style="margin: 0.25rem 0 0; font-size: 0.75rem; opacity: 0.6;">
            ${escapeHtml(this.sourceUrl || "unknown source")}
            ${this.line > 0 ? ` \u2014 line ${this.line}, column ${this.column}` : ""}
          </p>
        </div>

        <div style="background: #2a2a3e; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; overflow-x: auto;">
          <pre style="margin: 0; font-size: 0.8rem;" class="rawscript-error-frame"></pre>
        </div>

        ${chain.length > 1 ? `<div style="margin-bottom: 1rem; font-size: 0.75rem; opacity: 0.9;">
                <p style="margin: 0 0 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; opacity: 0.6;">Import chain</p>
                <pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(chain.join(" \u2192 "))}</pre>
              </div>` : ""}

        ${fix ? `<div style="background: #123524; border-left: 3px solid #22c55e; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem;">
                <p style="margin: 0 0 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; color: #4ade80;">How to fix</p>
                <p style="margin: 0; font-size: 0.8125rem;">${escapeHtml(fix)}</p>
              </div>` : ""}

        <div style="margin-top: 1rem; text-align: left; width: 100%;">
          <button
            style="background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          >
            Dismiss
          </button>
        </div>
      </div>
    `;
      const closeBtn = overlay.querySelector('button[aria-label="Dismiss error overlay"]');
      closeBtn?.addEventListener("click", () => this.hide());
      const dismissBtn = overlay.querySelector('div[style*="margin-top: 1rem"] button');
      dismissBtn?.addEventListener("click", () => this.hide());
      const frameEl = overlay.querySelector(".rawscript-error-frame");
      if (frameEl) {
        frameEl.textContent = "Fetching source\u2026";
        this.resolveCodeFrame().then((frame) => {
          frameEl.textContent = frame;
        });
      }
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 1e4);
      return overlay;
    }
    async resolveCodeFrame() {
      if (this.details?.frame)
        return this.details.frame;
      return this.fetchCodeFrame();
    }
    async fetchCodeFrame() {
      if (this.line > 0 && this.sourceUrl) {
        try {
          const response = await fetch(this.sourceUrl);
          if (response.ok) {
            const source = await response.text();
            const lines = source.split("\n");
            const start = Math.max(0, this.line - 3);
            const end = Math.min(lines.length, this.line + 2);
            const gutter = String(end).length;
            let frame = "";
            for (let i = start; i < end; i++) {
              const marker = i === this.line - 1 ? ">" : " ";
              frame += `${marker} ${String(i + 1).padStart(gutter)} \u2502 ${lines[i] ?? ""}
`;
              if (i === this.line - 1) {
                frame += `${marker} ${" ".repeat(gutter)} \u2502 ${" ".repeat(
                  Math.max(0, this.column - 1)
                )}^
`;
              }
            }
            return frame;
          }
        } catch {
        }
      }
      return this.generateCodeFrame();
    }
    generateCodeFrame() {
      const lines = this.error.message.split("\n");
      const errorLine = lines[0] || "";
      const match = errorLine.match(/\((\d+):(\d+)\):/);
      let frame = "";
      if (match) {
        const lineNum = parseInt(match[1], 10);
        const colNum = parseInt(match[2], 10);
        const start = Math.max(0, lineNum - 2);
        const end = Math.min(lines.length, lineNum + 1);
        for (let i = start; i < end; i++) {
          const lineContent = lines[i] || "";
          const prefix = i === lineNum - 1 ? "^" : " ";
          const colOffset = i === lineNum - 1 ? Math.max(0, colNum - 1) : 0;
          frame += `${i + 1}: ${lineContent}
`;
          frame += `${i + 1}${i === lineNum - 1 ? " ".repeat(colOffset) + prefix : " ".repeat(errorLine.length)}
`;
        }
      } else {
        frame = lines.join("\n");
      }
      return frame;
    }
    show() {
      document.body.appendChild(this.overlay);
    }
    hide() {
      this.overlay.remove();
    }
  };
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function showErrorOverlay(error, sourceUrl, line, column, details = null) {
    const overlay = new ErrorOverlay(error, sourceUrl, line, column, details);
    overlay.show();
  }

  // src/hmr.ts
  var DEFAULT_HMR_INTERVAL = 1e3;
  var hmrInterval = null;
  function startHmrPolling() {
    if (!env.isHmrEnabled)
      return;
    if (hmrInterval !== null)
      return;
    const interval = env.hmrInterval ?? DEFAULT_HMR_INTERVAL;
    hmrInterval = window.setInterval(() => checkFileChanges(), interval);
  }
  function checkFileChanges() {
    const tsFiles = document.querySelectorAll(
      'script[type="module"][src$=".ts"], script[type="module"][src$=".tsx"]'
    );
    if (tsFiles.length === 0)
      return;
    for (const script of tsFiles) {
      const src = script.getAttribute("src");
      if (!src)
        continue;
      fetch(src, { method: "HEAD" }).then((response) => {
        const etag = response.headers.get("etag");
        const lastModified = response.headers.get("last-modified");
        const storedEtag = script.getAttribute("data-etag");
        const storedLm = script.getAttribute("data-lm");
        if (etag === null && lastModified === null)
          return;
        if (storedEtag === null && storedLm === null) {
          if (etag)
            script.setAttribute("data-etag", etag);
          if (lastModified)
            script.setAttribute("data-lm", lastModified);
          return;
        }
        if (etag !== storedEtag || lastModified !== storedLm) {
          bustCacheAndReload(src);
        } else {
          if (etag)
            script.setAttribute("data-etag", etag);
          if (lastModified)
            script.setAttribute("data-lm", lastModified);
        }
      }).catch(() => {
      });
    }
  }
  function bustCacheAndReload(src) {
    if (!("serviceWorker" in navigator)) {
      location.reload();
      return;
    }
    const channel = new MessageChannel();
    const failSafe = setTimeout(() => location.reload(), 1500);
    channel.port1.onmessage = () => {
      clearTimeout(failSafe);
      location.reload();
    };
    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: "CACHE_BUST", url: src }, [channel.port2]);
    });
  }
  function initBroadcastChannel() {
    if (typeof window === "undefined" || !("BroadcastChannel" in window))
      return null;
    const channel = new BroadcastChannel("rawscript-hmr");
    channel.onmessage = (event) => {
      if (event.data?.type === "rawscript-reload") {
        location.reload();
      }
    };
    return channel;
  }

  // src/watcher.ts
  var DEV_ORIGINS = ["localhost", "127.0.0.1", "0.0.0.0"];
  function isDevOrigin() {
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";
    return DEV_ORIGINS.some((origin) => hostname === origin || hostname.endsWith(`.${origin}`));
  }
  function startWatcher() {
    if (!isDevOrigin())
      return;
    if (!("serviceWorker" in navigator))
      return;
    if (!env.isHmrEnabled)
      return;
    startHmrPolling();
  }

  // src/debugpanel.ts
  var DebugPanel = class {
    panel;
    visible = false;
    constructor() {
      this.panel = this.createPanel();
      document.body.appendChild(this.panel);
      this.bindKeyboardShortcuts();
    }
    bindKeyboardShortcuts() {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.hide();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "Backslash") {
          event.preventDefault();
          this.toggle();
        }
      });
    }
    createPanel() {
      const panel = document.createElement("div");
      panel.style.position = "fixed";
      panel.style.bottom = "0";
      panel.style.left = "0";
      panel.style.width = "100%";
      panel.style.maxWidth = "400px";
      panel.style.height = "400px";
      panel.style.background = "rgba(10, 10, 20, 0.95)";
      panel.style.color = "#e0e0e0";
      panel.style.fontFamily = "system-ui, monospace";
      panel.style.zIndex = "99999";
      panel.style.overflow = "auto";
      panel.style.boxShadow = "0 -4px 20px rgba(0, 0, 0, 0.5)";
      panel.style.display = "none";
      panel.style.flexDirection = "column";
      panel.innerHTML = `
      <div style="background: #1a1a2e; color: #fff; padding: 0.75rem 1rem; border-radius: 8px 8px 0 0; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 1rem;">Rawscript Dev Panel</h3>
        <button
          id="rawscript-debug-close"
          style="background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer; padding: 0;"
          onclick="this.parentElement.parentElement.style.display='none'"
        >
          \xD7
        </button>
      </div>

      <div style="padding: 1rem; flex-grow: 1;">
        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Service Worker Status</p>
          <p id="rawscript-sw-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Loading\u2026</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Importmap</p>
          <pre id="rawscript-importmap" style="margin: 0.25rem 0 0; font-size: 0.7rem; white-space: pre-wrap; max-height: 150px; overflow: auto;"></pre>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">HMR Status</p>
          <p id="rawscript-hmr-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Disabled in production</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">File Change Polling</p>
          <p id="rawscript-watcher-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">Stopped</p>
        </div>

        <div style="margin-bottom: 1rem;">
          <p style="margin: 0; font-size: 0.875rem; color: #aaa;">Performance</p>
          <p id="rawscript-perf-status" style="margin: 0.25rem 0 0; font-size: 0.8rem;">\u2014</p>
        </div>
      </div>

      <div style="background: #2a2a3e; padding: 0.75rem 1rem; border-radius: 0 0 8px; border-top: 1px solid #333; display: flex; gap: 0.5rem;">
        <button
          id="rawscript-cache-bust"
          style="flex: 1; background: #3b82f6; color: white; border: none; padding: 0.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          onclick="if(navigator.serviceWorker){navigator.serviceWorker.ready.then((reg)=>reg.active?.postMessage?.({type:'CACHE_BUST'}))};">
          Bust Cache
        </button>
        <button
          id="rawscript-reload"
          style="flex: 1; background: #ef4444; color: white; border: none; padding: 0.5rem; border-radius: 4px; font-size: 0.875rem; cursor: pointer;"
          onclick="location.reload()">
          Reload
        </button>
      </div>
    `;
      const closeBtn = panel.querySelector("#rawscript-debug-close");
      closeBtn?.addEventListener("click", () => this.hide());
      const cacheBustBtn = panel.querySelector("#rawscript-cache-bust");
      cacheBustBtn?.addEventListener("click", () => {
        if ("serviceWorker" in navigator) {
          ;
          navigator.serviceWorker.ready.then((reg) => {
            reg.active?.postMessage?.({ type: "CACHE_BUST" });
          });
        }
      });
      const reloadBtn = panel.querySelector("#rawscript-reload");
      reloadBtn?.addEventListener("click", () => {
        location.reload();
      });
      return panel;
    }
    toggle() {
      if (this.visible) {
        this.hide();
      } else {
        this.show();
      }
    }
    show() {
      this.panel.style.display = "flex";
      this.visible = true;
      this.updatePanel();
    }
    hide() {
      this.panel.style.display = "none";
      this.visible = false;
    }
    async updatePanel() {
      if (!("serviceWorker" in navigator)) {
        ;
        document.getElementById("rawscript-sw-status").textContent = "N/A";
        return;
      }
      const sw = navigator.serviceWorker.ready;
      sw.then((registration) => {
        const active = registration.active;
        document.getElementById("rawscript-sw-status").textContent = active?.scriptURL || "unknown";
        active?.postMessage?.({ type: "DEBUG_PANEL_REQUEST" });
      });
    }
  };

  // src/version.ts
  var RAWSCRIPT_VERSION = "0.2.0";
  var SW_PROTOCOL_VERSION = 1;

  // src/boot.ts
  var DEFAULT_SW_PATH = "/rawscript-sw.js";
  var hmrChannel = null;
  var debugPanel = null;
  var reloadScheduled = false;
  function reloadOnce() {
    if (reloadScheduled)
      return;
    reloadScheduled = true;
    location.reload();
  }
  function getScriptTag() {
    const tags = document.querySelectorAll('script[src*="rawscript"]');
    return tags[tags.length - 1];
  }
  function getSwPath(tag) {
    return tag?.getAttribute("data-sw-path") || DEFAULT_SW_PATH;
  }
  function isSwInline(tag) {
    return tag?.hasAttribute("data-sw-inline") ?? false;
  }
  function sendHandshake(sw) {
    const importmapEl = document.querySelector('script[type="importmap"]');
    let imports = {};
    if (importmapEl) {
      try {
        imports = JSON.parse(importmapEl.textContent || "{}").imports ?? {};
      } catch {
      }
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      handleVersionMessage(event.data);
    };
    sw.postMessage(
      {
        type: "HANDSHAKE",
        protocolVersion: SW_PROTOCOL_VERSION,
        rawscriptVersion: RAWSCRIPT_VERSION,
        importmap: imports
      },
      [channel.port2]
    );
  }
  function handleVersionMessage(data) {
    if (!data || typeof data !== "object")
      return;
    const msg = data;
    if (msg.type !== "SW_ACTIVATED" && msg.type !== "SW_READY")
      return;
    if (typeof msg.protocolVersion === "number" && msg.protocolVersion !== SW_PROTOCOL_VERSION) {
      console.warn(
        `rawscript: incompatible SW protocol (page ${SW_PROTOCOL_VERSION}, worker ${msg.protocolVersion}) \u2014 resetting caches`
      );
      navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "CACHE_BUST" }));
      reloadOnce();
      return;
    }
    if (msg.rawscriptVersion && msg.rawscriptVersion !== RAWSCRIPT_VERSION) {
      reloadOnce();
    }
  }
  function registerInlineSw(swPath) {
    return fetch(swPath).then((response) => response.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      return navigator.serviceWorker.register(url, { type: "module" });
    });
  }
  async function main() {
    const tag = getScriptTag();
    const swPath = getSwPath(tag);
    const inline = isSwInline(tag);
    const hmrInterval2 = parseInt(tag?.getAttribute("data-hmr-interval") ?? "", 10);
    if (!Number.isNaN(hmrInterval2)) {
      env.hmrInterval = hmrInterval2;
    }
    env.isHmrEnabled = env.isDev;
    if (!("serviceWorker" in navigator)) {
      runFallback();
      return;
    }
    showLoadingIndicator();
    let registration;
    try {
      registration = inline ? await registerInlineSw(swPath) : await navigator.serviceWorker.register(swPath, { type: "module" });
    } catch (err) {
      console.warn("rawscript: Service Worker registration failed, using Blob URL fallback.", err);
      hideLoadingIndicator();
      runFallback();
      return;
    }
    if (registration.active && !navigator.serviceWorker.controller) {
      sendHandshake(registration.active);
      reloadOnce();
      return;
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing)
        return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "activated") {
          if (registration.active)
            sendHandshake(registration.active);
          reloadOnce();
        }
      });
    });
    const active = registration.active ?? (await navigator.serviceWorker.ready).active;
    if (active)
      sendHandshake(active);
    hideLoadingIndicator();
    startWatcher();
    hmrChannel = initBroadcastChannel();
    debugPanel = new DebugPanel();
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object")
      return;
    if (data.type === "SW_ACTIVATED" || data.type === "SW_READY") {
      handleVersionMessage(data);
      return;
    }
    if (data.type === "TRANSPILE_ERROR") {
      const diagnostic = data;
      showErrorOverlay(
        new Error(diagnostic.message ?? "Unknown transpile error"),
        diagnostic.file ?? "",
        diagnostic.line ?? 0,
        diagnostic.column ?? 0,
        diagnostic
      );
    } else if (data.type === "CONFIG_WARNING") {
      console.warn(`rawscript [config]: ${data.option} \u2014 ${data.message}`);
    } else if (data.type === "CONFIG_ERROR") {
      console.error(`rawscript [config]: ${data.message}`);
      showErrorOverlay(
        new Error(data.message ?? "Unknown configuration error"),
        data.file ?? "/tsconfig.json",
        0,
        0
      );
    }
  });
  function onReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => main());
    } else {
      main();
    }
  }
  onReady();
})();
