# Troubleshooting

Every rawscript error is designed to answer four questions: **WHAT** failed,
**WHERE** (file, line, column with a code frame), **WHY**, and **HOW** to fix
it. This guide covers the scenarios that do not show a structured overlay.

## Error categories

The overlay classifies failures into these categories, each with a tailored
fix suggestion:

| Category | Trigger | Typical fix |
|---|---|---|
| Syntax error | Malformed code (esbuild parse failure) | Fix the marked line: bracket, brace, quote, semicolon |
| Module resolution error | A bare import could not be resolved | Add it to the importmap, or fix the relative path |
| Import error | `does not provide an export` / `No matching export` | Check the target module's export list |
| JSX configuration error | JSX found in a non-JSX-transpiled file | Rename to `.tsx` or set `jsx` in `tsconfig.json` |
| Compilation error | Any other esbuild failure | Read the code frame; run `rawscript typecheck` for more |

If the overlay does not appear (for example, the error happened before the
runtime loaded), open the browser console — the SW also logs structured
messages there.

## First load is slow (2-4s)

Expected: the esbuild WASM binary (~8MB) must be downloaded and initialized on
the very first visit. It is pre-cached by the Service Worker's `install`
event, so **subsequent loads are fast**. If the WASM download fails (offline,
corporate proxy), the page cannot compile TypeScript — fix the network, not
the code.

## Page never becomes interactive after the SW takes over

The runtime performs **exactly one** controlled reload after the SW claims
the page. If the page loops reloading:

1. Check for a `rawscript-sw.js` 404 — the SW file must be served from your
   origin (or use `data-sw-inline` when loading from unpkg, see README).
2. Check the console for a protocol/handshake error: `rawscript-sw.js` and
   `rawscript.js` must be the **same version**. Mixed versions trigger one
   reload and then error — clear site data and reload.
3. If you cache `rawscript-sw.js` in your own service worker with a long
   max-age, clear that cache. The SW must be able to update.

## "not a valid JavaScript MIME type" in Safari

On the very first load, a raw `.ts` module fetch can reach the browser before
the SW controls the page, producing this console error. It is expected,
transient, and disappears after the controlled activation reload. If it
persists after the page is interactive, your server is serving `.ts` files
with the wrong MIME type — the SW handles the transpiled response, but the
first pre-control fetch still needs a server that does not choke on `.ts`.

## Hot reload does not pick up changes

HMR is dev-only (localhost / 127.0.0.1) and polls `.ts` files via `HEAD`
requests comparing `ETag` / `Last-Modified`. If your server does not send
either header, changes are picked up on plain page reload instead (the SW
re-fetches sources on every request and compares content fingerprints, so a
reload never serves stale code). Increase the poll interval if the polling is
noisy: `data-hmr-interval="2000"` on the boot script.

## "Module resolution error: could not be resolved"

A bare import has no import map entry and no CDN fallback is available.
Either:

- add the specifier to the HTML import map, e.g.
  `"react": "https://esm.sh/react@18.3.1"`, or
- if you run with `cdn.enabled: false` (strict mode), add a local
  dependency: run `rawscript deps` or `rawscript build --local-deps` and
  deploy the generated import map.

**Relative imports need full specifiers.** The browser module loader
requires extensions in relative module imports: use `./lib.ts`, not
`./lib`. Bundler-style extensionless resolution works in the CLI build
(`rawscript build` uses esbuild), but the browser runtime resolves exactly
what you write.

## Compile errors in the overlay but code looks fine

Check the **import chain** shown at the bottom of the overlay — the error may
be in a dependency of the failing file. If the chain shows generated code,
the fix still belongs in the original source file (the code frame maps back
to it).

## `rawscript typecheck` reports errors but the page works

`rawscript build` transpiles and bundles without type-checking — that is
deliberate (esbuild strips types, it does not verify them). Type errors are
real; run `rawscript typecheck` (or `build --typecheck`) in CI to make them
fail the build.

## `--local-deps` build fails with an install hint

In `--local-deps` mode npm/pnpm are the dependency authority: every imported
package must be installed in the project's `node_modules`. The error message
tells you exactly which package is missing and what to run (`npm install` /
`pnpm install`). There is no silent fallback to the CDN.

## Cache corruption / stale behavior

The SW never trusts its cache:

- every compiled artifact is keyed by a content fingerprint (source + import
  map + tsconfig + esbuild version + runtime version);
- cached responses carry a body hash checked on every hit — a corrupt entry
  is deleted and recompiled automatically;
- cache names are versioned (`rawscript-transpiled-v2`, `rawscript-meta-v1`,
  `rawscript-wasm-v1`, `rawscript-deps-v1`); a protocol version bump wipes
  them on activation.

If you still suspect a stale install (for example, after upgrading rawscript
in place), clear site data or re-register:

```js
navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
```

Then reload.

## Dependencies fail while offline

Dependencies are cache-first: import map values (typically esm.sh URLs) are
stored in the dependency cache as they are fetched, so an already-loaded
module graph keeps working offline. A dependency that was **never** loaded
cannot be served offline — load the app once online before going offline.
For fully offline deployments, use `rawscript vendor` (no external network at
any point) or `rawscript build --local-deps` (self-contained production
output).

## Service Worker not registering

Check: the page is served over `http(s)://` (not `file://`), the SW is not
blocked by a cross-origin constraint (`data-sw-inline` bypasses it), and the
SW script URL is reachable. In sandboxed iframes and on `file://`, rawscript
falls back to the Blob-URL loader — it works, logs a warning, and is slower.

## CSP blocks the runtime

Two CSP modes are supported by the preview server (`RAWSCRIPT_CSP=default|strict`):

- `strict` — for self-hosted deployments; your page must not need
  `'unsafe-inline'` or external script hosts;
- `default` — adds `'unsafe-inline'` plus `https://unpkg.com https://esm.sh`
  for the zero-config CDN path.

If your own CSP is stricter, ensure it allows `'wasm-unsafe-eval'` (WASM
compilation), your origin for the SW and module scripts, and — only if you use
the zero-config CDN path — `https://unpkg.com` and `https://esm.sh`.

## Still stuck

1. Capture the browser console (including the SW's structured messages).
2. Report with the bug template: browser + version, page URL (or a minimal
   repro), the overlay's WHAT/WHERE/WHY/HOW, and the console output.
3. If it is a security concern (poisoned cache, traversal, CSP bypass),
   report privately to **security@rawscript.dev** instead of opening an issue.