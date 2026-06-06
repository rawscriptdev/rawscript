# Rawscript

[![npm](https://img.shields.io/npm/v/rawscript?color=000&labelColor=000)](https://www.npmjs.com/package/rawscript)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/rawscript?color=000&labelColor=000&label=runtime)](https://bundlephobia.com/package/rawscript)
[![license](https://img.shields.io/github/license/rawscript-dev/rawscript?color=000&labelColor=000)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-000?labelColor=000)](./packages/runtime/package.json)

TypeScript in the browser. No build step. No terminal.

```html
<script src="https://unpkg.com/rawscript"></script>
<script type="module" src="./main.ts"></script>
```

That is the entire setup. `main.ts` can use TypeScript syntax, import from npm, and use JSX. It just works.

---

## How it works

rawscript registers a [Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) that intercepts every `.ts` and `.tsx` network request before it reaches the browser's module loader. The SW fetches the raw source, compiles it in-browser using [esbuild-wasm](https://esbuild.github.io/getting-started/#wasm), rewrites bare specifiers to [esm.sh](https://esm.sh) CDN URLs, and returns the result as `application/javascript`.

From the browser's perspective, it made a request for a `.js` file. It has no idea TypeScript was involved.

```
Browser                    Service Worker              Network
──────                     ──────────────              ───────
import './main.ts'   →     fetch('/main.ts')      →   your server
                     ←     transpile(source)
                     ←     rewriteImports(js)
import './main.js' ←       Response(js, { 'Content-Type': 'application/javascript' })
```

The esbuild WASM binary (~8MB) is pre-cached on the SW's `install` event. After the first load, compilation is instant.

---

## Importing npm packages

Bare specifiers are automatically rewritten to esm.sh URLs. No importmap required.

```ts
// This works. No npm install. No importmap.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'

const App = () => {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n => n + 1)}>count: {n}</button>
}

createRoot(document.getElementById('app')!).render(<App />)
```

To pin a version: `import React from 'react@18.3.1'`  
To use a subpath: `import { signal } from '@preact/signals-core'`

If you have an importmap in the HTML, rawscript respects it. Any specifier already mapped will not be rewritten.

---

## Framework support

rawscript detects the JSX transform from your importmap.

| Framework | importmap entry | JSX source |
|---|---|---|
| React (default) | — | `react` |
| Preact | `"react": "https://esm.sh/preact/compat"` | `preact/compat` |
| Solid | `"solid-js": "https://esm.sh/solid-js"` | `solid-js/h` |
| Vue | — | No JSX; use `h()` or `defineComponent` |

Vue `.vue` SFC files are not supported. Use the Composition API with `.ts` files and `h()`.

See [`examples/`](./examples) for working demos of each.

---

## Production builds

The browser runtime is a development tool. For production, use the CLI to produce a minified bundle with no rawscript runtime:

```sh
npx rawscript build
```

Reads `index.html`, finds all `<script type="module" src="*.ts">` entries, bundles them with esbuild (Node API, not WASM), and writes to `dist/`. The output contains no reference to rawscript and no in-browser transpilation — but npm dependencies are still resolved through the esm.sh importmap, so production output requires network access to esm.sh.

```sh
npx rawscript build --entry index.html --out dist --no-minify
npx rawscript build --typecheck   # run the real TypeScript compiler first, abort on errors
npx rawscript serve               # static file server on :3000, no config
npx rawscript typecheck           # type-check the project (noEmit), exit 1 on errors
```

With `--local-deps`, npm/pnpm dependencies are bundled from the project's local `node_modules` instead of externalized: the production output then has no runtime CDN dependency, and dynamic imports are code-split into shared chunk files. npm/pnpm remain the dependency authority — run `npm install` / `pnpm install` first; a missing dependency fails the build with an actionable message instead of silently falling back to the CDN.

```sh
npx rawscript build --local-deps   # bundle deps from the local node_modules
```

`rawscript deps` runs the bundling step alone: it bundles the packages your project actually imports into browser-ready ESM and prints a standard browser import map (also written to `importmap.json`) that points bare specifiers at those local files — no CDN, no custom rewriting:

```sh
npx rawscript deps   # bundles to .rawscript/deps/ and prints the import map
```

`rawscript preview` serves a production output directory exactly as it would be deployed — same MIME types, ETag / Last-Modified headers, and traversal guards as the dev server:

```sh
npx rawscript preview --dir dist --port 3000
```

Deployment notes: the output of `rawscript build` is fully static — host `dist/` on any static file server or CDN. In the default mode the importmap references esm.sh at runtime; in `--local-deps` mode the output is self-contained (no esm.sh, no rawscript). What `rawscript preview` serves is exactly what you deploy, so the preview round-trip doubles as a smoke test for the deployment.

**`build` and `typecheck` are deliberately different operations:**

- `rawscript build` transpiles and bundles — it does **not** type-check. esbuild strips types without verifying them.
- `rawscript typecheck` runs the real TypeScript compiler (`tsc`) with `noEmit` and reports every diagnostic with file, line, and column. Use it in CI, editors, or `build --typecheck` to fail a production build on type errors. Without a `tsconfig.json` it applies browser-friendly defaults (strict, ESNext, bundler module resolution, DOM libs); with one it honors `include`/`exclude` and all compiler options.

The CLI uses esbuild, commander, and typescript as dependencies. These are never part of the browser runtime.

---

## Architecture

```
rawscript/
├── .github/workflows/      # ci.yml (PR + push), publish.yml (v* tags)
├── packages/
│   ├── runtime/            # Zero-dependency browser library
│   │   ├── src/
│   │   │   ├── boot.ts       # Main thread: SW registration, HMR wiring, error overlay
│   │   │   ├── sw.ts         # Service Worker: fetch interception, cache, orchestration
│   │   │   ├── transpiler.ts # esbuild-wasm wrapper, lazy-initialized
│   │   │   ├── resolver.ts   # Bare import → esm.sh rewriter (pure regex)
│   │   │   ├── loader.ts     # First-load progress indicator
│   │   │   ├── hmr.ts        # ETag polling + CACHE_BUST via MessageChannel
│   │   │   ├── watcher.ts    # Dev-mode coordinator (polls only when HMR enabled)
│   │   │   ├── fallback.ts   # Blob URL fallback for file:// and sandboxed iframes
│   │   │   ├── env.ts        # Environment detection (SW available, HMR allowed, esm)
│   │   │   ├── errors.ts     # Error overlay with source code frame
│   │   │   └── debugpanel.ts # Ctrl/Cmd+Shift+\ dev panel
│   │   ├── build.js          # esbuild bundle → dist/rawscript.js + dist/rawscript-sw.js
│   │   └── dist/             # IIFE entry + ESM service worker (copied to repo root for dev)
│   └── cli/
│       ├── src/
│       │   ├── index.ts      # commander entry, build + serve commands
│       │   ├── bundler.ts    # esbuild Node API wrapper, HTML rewrite, importmap merge
│       │   └── serve.ts      # zero-config static server
│       └── build.mjs         # bundles the CLI into a single self-contained dist/cli.mjs
├── scripts/serve.mjs         # static server used by the e2e suite
├── tests/                    # Playwright e2e (smoke, jsx, examples, cli) + resolver units
└── examples/                 # vanilla, react, preact, solid, vue, three
```

**The invariant that must never break:** `packages/runtime/package.json` → `"dependencies": {}`. The runtime is static files served from a CDN. It has no install step because it imposes no install step.

### Two output files

| File | Format | Entry | Size |
|---|---|---|---|
| `dist/rawscript.js` | IIFE | `boot.ts` | ~31KB (minified, ~9KB gz) |
| `dist/rawscript-sw.js` | ESM | `sw.ts` | ~9KB (esbuild-wasm imported externally) |

`rawscript.js` is the script tag users include. It registers the SW and handles the initial reload. `rawscript-sw.js` is registered at `/rawscript-sw.js` by default and does all the actual work.

### Service Worker scope constraint

The SW must be served from your origin. When loading rawscript from unpkg, add `data-sw-inline`:

```html
<script src="https://unpkg.com/rawscript" data-sw-inline></script>
```

This fetches `rawscript-sw.js` and registers it as a Blob URL, bypassing the cross-origin restriction. Slightly slower to register on first load, but functionally identical.

To host it yourself (recommended for production-like setups):

```
dist/rawscript-sw.js  →  /rawscript-sw.js  (serve from root)
```

Or configure a custom path:

```html
<script src="..." data-sw-path="/static/rawscript-sw.js"></script>
```

---

## Hot reload

In dev mode (localhost or `127.0.0.1`), rawscript polls your `.ts` files using `HEAD` requests and compares `ETag` / `Last-Modified` headers. On change, the SW busts its module cache for that file and the page reloads.

No dev server required. No WebSocket. No Node process. Polling interval defaults to 1000ms and is configurable:

```html
<script src="..." data-hmr-interval="500"></script>
```

Hot reload is disabled in production (any non-localhost origin).

Even with polling disabled, a plain page reload always picks up edits: the SW re-fetches every source file on each request and compares it against a content fingerprint, so the cache can never serve stale code after a reload.

---

## Caching and updates

rawscript never invalidates caches by hand. Every compiled artifact is keyed by a content fingerprint that covers the source file **and** everything that affects its output: the HTML import map, tsconfig settings, the esbuild version, and the rawscript runtime version.

- The SW re-fetches the source on every request (`cache: 'no-store'`), computes the fingerprint, and serves the cached output only if it matches. Any change — source edit, import map entry, tsconfig tweak — produces a new fingerprint and a fresh compile.
- Cached responses carry a body hash checked on every hit. A corrupt entry (truncated write, partial eviction) is detected, deleted, and recompiled automatically.
- Cache failures are never fatal: quota errors during writes and network failures during fetches degrade to stale-but-working output instead of broken pages.
- Cache names are versioned (`rawscript-transpiled-v2`, `rawscript-meta-v1`, `rawscript-wasm-v1`, `rawscript-deps-v1`). When the SW protocol version changes, the SW wipes all rawscript caches on activation.
- Dependencies are cache-first: import map values (typically third-party URLs such as esm.sh) are stored in the dependency cache as they are fetched, so an already-loaded module graph keeps working when the network goes away.

The SW and the page talk through a small message protocol: the page sends a handshake (via a `MessageChannel` port), the SW replies with its protocol and rawscript versions, and a version mismatch triggers exactly one controlled reload. The first load performs at most one reload, so there is no reload loop.

---

## Configuration

There is deliberately **no `rawscript.config.*` file**. The configuration surface is exactly:

- `tsconfig.json` — JSX settings, paths aliases, type checking (via the CLI)
- the HTML import map — dependency versions
- `data-*` attributes on the boot script tag — runtime knobs like the HMR interval

That covers everything a rawscript project genuinely needs to configure, and it keeps the zero-config story intact. If a need appears that these cannot express, a config file will be added then — not before.

---

## Diagnostics

Compile errors surface as a structured overlay on the page, answering four questions:

- **WHAT** — the error category (syntax, resolution, JSX, tsconfig, runtime) and message
- **WHERE** — the file, line, and column, with a code frame marking the error line
- **WHY** — a plain-language explanation of the likely cause
- **HOW** — a concrete fix suggestion, plus the import chain that led to the failing file

The overlay auto-hides after a few seconds and shows a compact toast on subsequent loads. Warnings (for example, unsupported tsconfig options) appear as non-blocking `[config]` badges. For type errors, use `rawscript typecheck` in the CLI, which runs the real TypeScript compiler.

---

## Fallback: file:// and sandboxed iframes

Service Workers are unavailable on `file://` protocol, in cross-origin iframes, and in some browser configurations. In these contexts, rawscript automatically switches to a Blob URL fallback:

1. Finds all `<script type="module" src="*.ts">` tags in the document
2. Fetches each source file, transpiles it in the main thread (esbuild-wasm, same WASM binary)
3. Rewrites imports, resolves relative imports recursively via Blob URLs
4. Replaces each script's `src` with a `Blob` URL

The fallback is slower (no cross-load caching, main thread transpilation) and logs a warning. It exists so rawscript works everywhere, not as a preferred path.

---

## Browser support

| Browser | Minimum version | Notes |
|---|---|---|
| Chrome / Edge | 89 | Full support |
| Firefox | 114 | Module-type Service Workers |
| Safari | 16.4 | Import maps + module SW |

Requirements: module-type Service Workers, ES modules, import maps, `BroadcastChannel`, `fetch`. IE is not supported.

---

## Tradeoffs

rawscript is the right tool in specific contexts. It is not a replacement for a proper build setup.

**Use rawscript when:**
- Prototyping or building demos where setup friction matters
- Teaching TypeScript without requiring a dev environment
- Embedding interactive TypeScript examples in docs or articles
- Building single-page tools that you want to share as a raw HTML file

**Do not use rawscript when:**
- You need reproducible, auditable production builds
- Your app imports large dependency graphs (each is fetched individually from esm.sh)
- You need tree-shaking or code splitting on dependencies
- Offline support is a requirement (esm.sh dependencies require network)

**Performance characteristics:**
- First load: ~2–4s while esbuild WASM initializes and caches (shown as a loading indicator)
- Subsequent loads: <100ms (WASM served from SW cache, transpiled output cached per-file)
- Transpilation: ~5–50ms per file depending on size (esbuild is fast even in WASM mode)
- Production build via CLI: uses esbuild Node API, not WASM — full speed

---

## Development

```sh
git clone https://github.com/rawscript-dev/rawscript
cd rawscript
pnpm install
pnpm build        # builds packages/runtime/dist/
```

To run an example:

```sh
pnpm serve        # serves project root on :3000
# open http://localhost:3000/examples/react/
```

There is no watch mode for the examples. Edit a source file in `packages/runtime/src/`, run `pnpm build`, reload. The SW's HMR handles `.ts` file changes in examples during development — it does not handle changes to the runtime itself.

### Running tests

```sh
pnpm test:unit    # resolver unit tests (node:test)
pnpm test:e2e     # Playwright e2e across chromium/firefox/webkit
pnpm test         # both
pnpm typecheck    # tsc --noEmit across all packages
```

The e2e suite launches real browsers via Playwright and covers: SW fetch interception + WASM pre-caching, importmap-driven JSX transforms, all five framework examples, and the CLI's build + serve round-trip. There are no unit tests for the SW itself — integration tests against a real browser are more reliable for fetch interception behavior.

### Adding a new runtime module

1. Create `packages/runtime/src/yourmodule.ts`
2. Import it from `sw.ts` or `boot.ts` (wherever it belongs)
3. Run `pnpm build` — esbuild picks it up automatically
4. Never add it to `"dependencies"` in `package.json`

### Bumping the esbuild-wasm version

The version is pinned in two places and must match:

```
packages/runtime/src/transpiler.ts  → wasmURL: 'https://unpkg.com/esbuild-wasm@X.X.X/esbuild.wasm'
packages/runtime/src/sw.ts          → import ... from 'https://unpkg.com/esbuild-wasm@X.X.X/esm/browser.js'
```

Also bump the cache name in `sw.ts` (`rawscript-wasm-vN`) to force re-fetch on existing installs.

---

## Release

Releases are automated via GitHub Actions on version tags.

```sh
git tag v0.2.0
git push origin v0.2.0
```

The `publish.yml` workflow runs typecheck, build, and the full test suite, then publishes `rawscript` (runtime) followed by `rawscript-cli` to npm with provenance. Keep the version in sync across `package.json`, `packages/runtime/package.json`, and `packages/cli/package.json`.

---

## Contributing

Issues and PRs are welcome. A few things to know before contributing:

- **The zero-dependency constraint is absolute.** If your change requires adding a runtime dependency to `packages/runtime/package.json`, it will not be merged regardless of how useful the feature is.
- **The SW is the critical path.** Changes to `sw.ts` or `transpiler.ts` require Playwright tests that cover the actual fetch interception. Untested SW changes have caused subtle bugs that only manifest in specific browser versions.
- **resolver.ts is intentionally regex-based.** We know a proper AST parser would be more correct. We have chosen not to add one. The regex handles all real-world cases we've encountered, and it has unit tests in `tests/unit/`. If you've found one it doesn't handle, open an issue with a reproduction.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup details and the release process.

---

## Prior art

- [esm.sh](https://esm.sh) — CDN that makes this possible
- [esbuild](https://esbuild.github.io) — the compiler rawscript runs in your browser
- [ts-blank-space](https://github.com/bloomberg/ts-blank-space) — alternative approach: strips types without transpiling
- [TypeScript playground](https://www.typescriptlang.org/play) — sandboxed, no import support
- [StackBlitz](https://stackblitz.com) — full dev environment, requires their infrastructure

rawscript's niche is the space between "paste into a playground" and "set up a real project." It works with your own files, on your own server, with no account.

---

## License

MIT © rawscript contributors