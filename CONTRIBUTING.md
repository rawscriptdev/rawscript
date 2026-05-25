# Contributing to rawscript

Thanks for helping out! This project follows a few simple rules to keep things
reviewable and the zero-dependency promise intact.

## Prerequisites

- Node.js >= 18 (dev machine uses >= 20)
- pnpm 9 (`corepack enable pnpm` or `npm i -g pnpm@9`)

## Setup

```sh
pnpm install
pnpm build          # builds packages/runtime → dist/ + repo-root copies
pnpm typecheck      # tsc across all workspace packages
```

## Running tests

```sh
pnpm test:unit      # resolver unit tests (node:test)
pnpm test:e2e       # Playwright across chromium/firefox/webkit
pnpm test           # both

npx playwright install chromium firefox webkit   # one-time browser setup
```

The e2e suite starts a static server on port 4300 and the CLI tests spawn
their own server on 4321+ (one port per worker). Keep those ports free.

Note: the e2e script runs webkit serially (`--workers=1`) — WebKit's
renderer on Windows hits a small JS heap limit and dies under parallel
load, so the suite splits chromium+firefox (parallel) from webkit
(serial). CI keeps its own `workers: 2` setting.

## Project layout

```
packages/runtime/   browser runtime: boot, service worker, transpiler, resolver, HMR, fallback
packages/cli/       build + serve CLI (`rawscript build`, `rawscript serve`, `rawscript typecheck`, `rawscript preview`, `rawscript deps`)
examples/           framework examples used by the e2e suite
scripts/            dev static server
tests/              Playwright e2e (smoke, jsx, examples, cli, cache, tsconfig) + node:test units
```

## Conventions

- `packages/runtime` ships **zero runtime dependencies** — never add one to
  its `dependencies`. Bundled esbuild WASM runs inside the service worker.
- The import rewriter (`resolver.ts`) is intentionally regex-based, not AST —
  documented architectural decision; keep it that way and extend the unit
  tests in `tests/unit/` when you touch it.
- Cache names in `sw.ts` are versioned and asserted by `tests/smoke.spec.ts`:
  `rawscript-wasm-v1` (esbuild WASM binary), `rawscript-transpiled-v2`
  (compiled output, keyed by content fingerprint), `rawscript-meta-v1` (SW
  meta state). Bump the transpiled/meta names when the cache schema or the
  SW protocol (`SW_PROTOCOL_VERSION` in `version.ts`) changes; a protocol
  bump makes the SW purge all `rawscript-*` caches on activation.
- The CLI has two dependency modes: the default externalizes npm imports to
  an esm.sh importmap, while `--local-deps` bundles them from the project's
  local node_modules (and `rawscript deps` builds per-package bundles plus
  an import map). npm/pnpm are the dependency authority — the CLI must never
  download, resolve, or manage packages itself; missing dependencies are
  build errors with install hints, never silent CDN fallbacks.
- Version bumps: runtime and cli are published in lockstep from the same
  `v0.x.y` tag — update the version in all three `package.json` files,
  `packages/runtime/src/version.ts`, and (if the transpile output changes)
  the cache names in `sw.ts`.
- Prefer small, focused commits with conventional prefixes
  (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Release process

Tag `v0.x.y` on main and push — `.github/workflows/publish.yml` runs the full
test suite and publishes `rawscript` then `rawscript-cli` to npm.