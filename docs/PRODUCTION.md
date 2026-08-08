# Production Guide

The browser runtime is a development tool. Production output is produced by
the CLI — a minified bundle with no rawscript runtime, built with the esbuild
Node API (not WASM). This guide walks through the production workflow.

## 1. Build

```sh
npx rawscript build
```

Reads `index.html`, finds `<script type="module" src="*.ts">` entries,
bundles them, and writes to `dist/`. Options:

```sh
npx rawscript build --entry index.html --out dist --no-minify
npx rawscript build --typecheck   # real tsc first; abort on type errors
```

**`build` transpiles but does not type-check** — use `--typecheck` or the
separate `rawscript typecheck` command in CI (real TypeScript compiler,
`noEmit`, honors your `tsconfig.json`).

## 2. Choose a dependency strategy

| Mode | Command | Result | Network need |
|---|---|---|---|
| CDN | `build` (default) | import map references esm.sh | esm.sh at runtime |
| Local deps | `build --local-deps` | deps bundled from your `node_modules`; code-split dynamic imports | none (self-contained) |
| Local import map | `deps` | bundles imported packages to `.rawscript/deps/` + prints/writes `importmap.json` | none for mapped specifiers |

`--local-deps`: npm/pnpm remain the dependency authority — run
`npm install`/`pnpm install` first; a missing package fails the build with an
actionable install hint (no silent CDN fallback). `deps` alone just does the
bundling step and gives you a standard browser import map.

## 3. Preview (deployment smoke test)

```sh
npx rawscript preview --dir dist --port 3000
```

Serves the output exactly as deployed: same MIME types, `ETag` /
`Last-Modified`, traversal guards, and (with `RAWSCRIPT_CSP=default|strict`)
the same CSP headers. What preview serves is what you deploy.

## 4. Deploy

The build output is fully static — host `dist/` on any static file server or
CDN.

- Default mode: the import map references esm.sh at runtime (requires
  network; document it).
- `--local-deps` mode: self-contained — no esm.sh, no rawscript runtime, no
  build step at deploy time.

## 5. Runtime in production (no bundle)

If you run the rawscript **runtime** in production rather than bundling,
self-host everything:

```sh
npx rawscript vendor --dir rawscript   # runtime + SW + esbuild-wasm, patched to be local
```

```html
<script>
  window.rawscriptConfig = {
    cdn: { enabled: false },          // strict: unmapped bare imports error
  }
</script>
<script src="/rawscript/rawscript.js"></script>
```

A vendored deployment needs no external network at any point, first load
included. See [Self-hosting](../README.md#self-hosting) in the README.

## Offline behavior

After a successful load, the page keeps working with esm.sh/unpkg
unreachable: the compiler shim comes from the browser HTTP cache, WASM from
the SW's WASM cache, compiled `.ts` from the content-fingerprint cache, and
dependencies from the cache-first dependency cache. A vendored deployment is
offline-capable from the very first load.

## CI checklist

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter rawscript-cli build
pnpm typecheck
pnpm test:unit
npx playwright test --project=chromium --project=firefox
npx playwright test --project=webkit --workers=1
pnpm audit --prod --audit-level high
```

This is exactly what `.github/workflows/ci.yml` runs.