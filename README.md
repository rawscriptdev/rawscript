# Rawscript

[![npm](https://img.shields.io/npm/v/rawscript?color=000&labelColor=000)](https://www.npmjs.com/package/rawscript)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/rawscript?color=000&labelColor=000&label=runtime)](https://bundlephobia.com/package/rawscript)
[![license](https://img.shields.io/github/license/rawscript/rawscript?color=000&labelColor=000)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-000?labelColor=000)](./packages/runtime/package.json)

TypeScript in the browser. No build step. No npm. No terminal.

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

rawscript is a development tool. For production, use the CLI to produce a minified, CDN-free bundle:

```sh
npx rawscript build
```

Reads `index.html`, finds all `<script type="module" src="*.ts">` entries, bundles them with esbuild (Node API, not WASM), and writes to `dist/`. The output has no CDN dependencies and no reference to rawscript itself.

```sh
npx rawscript build --entry index.html --out dist --no-minify
npx rawscript serve   # static file server on :3000, no config
```

The CLI uses esbuild and commander as dependencies. These are never part of the browser runtime.

---

## Architecture

```
rawscript/
├── packages/
│   ├── runtime/              # Zero-dependency browser library
│   │   └── src/
│   │       ├── boot.ts       # Main thread: SW registration, reload logic
│   │       ├── sw.ts         # Service Worker: fetch interception, orchestration
│   │       ├── transpiler.ts # esbuild-wasm wrapper, lazy-initialized
│   │       ├── resolver.ts   # Bare import → esm.sh rewriter (pure regex)
│   │       ├── loader.ts     # First-load progress indicator
│   │       ├── hmr.ts        # BroadcastChannel-based change notification
│   │       ├── watcher.ts    # ETag polling, dev mode only
│   │       ├── fallback.ts   # Blob URL fallback for file:// and sandboxed iframes
│   │       ├── env.ts        # Environment detection (SW available, isDev, etc.)
│   │       ├── errors.ts     # Error overlay, sourcemap-aware
│   │       └── debugpanel.ts # Ctrl+Shift+R dev panel
│   └── cli/
│       └── src/
│           ├── index.ts      # commander entry, build + serve commands
│           ├── bundler.ts    # esbuild Node API wrapper
│           └── html.ts       # HTML parser: finds .ts entries, rewrites output
└── examples/
    ├── vanilla/
    ├── react/
    ├── preact/
    ├── vue/
    ├── solid/
    └── three/
```

**The invariant that must never break:** `packages/runtime/package.json` → `"dependencies": {}`. The runtime is static files served from a CDN. It has no install step because it imposes no install step.

### Two output files

| File | Format | Entry | Size |
|---|---|---|---|
| `dist/rawscript.js` | IIFE | `boot.ts` | ~2kb min+gz |
| `dist/rawscript-sw.js` | ESM | `sw.ts` | ~300kb (esbuild-wasm ref, not inlined) |

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

In dev mode (`localhost` or `127.0.0.1`), rawscript polls your `.ts` files using `HEAD` requests and compares `ETag` / `Last-Modified` headers. On change, the SW busts its module cache for that file and the page reloads.

No dev server required. No WebSocket. No Node process. Polling interval defaults to 1000ms and is configurable:

```html
<script src="..." data-hmr-interval="500"></script>
```

Hot reload is disabled in production (any non-localhost origin).

---

## Fallback: file:// and sandboxed iframes

Service Workers are unavailable on `file://` protocol, in cross-origin iframes, and in some browser configurations. In these contexts, rawscript automatically switches to a Blob URL fallback:

1. Finds all `<script type="module" src="*.ts">` tags in the document
2. Fetches each source file, transpiles it in the main thread (esbuild-wasm, same WASM binary)
3. Rewrites imports, resolves relative imports recursively
4. Replaces each script's `src` with a `Blob` URL

The fallback is slower (no cross-load caching, main thread transpilation) and logs a warning. It exists so rawscript works everywhere, not as a preferred path.

---

## Browser support

| Browser | Minimum version | Notes |
|---|---|---|
| Chrome / Edge | 89 | Full support |
| Firefox | 84 | Full support |
| Safari | 15.4 | Full support |
| Firefox ESR | 91 | Full support |
| IE | — | Not supported |

Requirements: Service Workers, ES modules, `BroadcastChannel`, `fetch`. All present in any browser released after 2021.

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
git clone https://github.com/rawscript/rawscript
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
pnpm test         # Playwright end-to-end tests
pnpm typecheck    # tsc --noEmit across all packages
```

Tests launch a real browser via Playwright. There are no unit tests for the SW itself — integration tests against a real browser are more reliable for fetch interception behavior.

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
npm version patch   # or minor / major
git push --follow-tags
```

The `publish.yml` workflow runs `npm ci`, `npm test`, and `npm publish` from `packages/runtime/`. The CLI (`packages/cli/`) is published separately under the same `rawscript` package name with a `bin` entry.

---

## Contributing

Issues and PRs are welcome. A few things to know before contributing:

- **The zero-dependency constraint is absolute.** If your change requires adding a runtime dependency to `packages/runtime/package.json`, it will not be merged regardless of how useful the feature is.
- **The SW is the critical path.** Changes to `sw.ts` or `transpiler.ts` require Playwright tests that cover the actual fetch interception. Untested SW changes have caused subtle bugs that only manifest in specific browser versions.
- **resolver.ts is intentionally regex-based.** We know a proper AST parser would be more correct. We have chosen not to add one. The regex handles all real-world cases we've encountered. If you've found one it doesn't handle, open an issue with a reproduction.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup details and the list of good first issues.

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
