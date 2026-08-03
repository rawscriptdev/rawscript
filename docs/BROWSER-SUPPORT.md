# Browser Support

Rawscript is a browser-native tool: the runtime is a Service Worker plus an
ES module compiler that runs entirely in the browser. That means its support
story is defined by what browsers actually ship, and it is verified by an
automated test matrix, not by claims.

## Tested matrix

The e2e suite (`pnpm test:e2e`) runs the **same** 71 tests against three
browser engines in CI (`.github/workflows/ci.yml`):

| Engine | CI runner | Project | Coverage |
|---|---|---|---|
| Chromium (Chrome, Edge, Brave, Opera) | ubuntu-latest | `chromium` | full suite |
| Firefox | ubuntu-latest | `firefox` | full suite |
| WebKit (Safari) | macos-latest | `webkit` | full suite (1 worker) |

The suite covers: SW fetch interception and WASM pre-caching, JSX transforms
for React/Preact/Solid/Vue, all framework examples, the CLI build/serve
round-trip, dependency cache poisoning defense, strict CSP responses, and
self-hosting (CDN-disabled pages, offline reloads with esm.sh/unpkg blocked,
vendored compiler deployments).

## Minimum versions

| Browser | Minimum | Why |
|---|---|---|
| Chrome / Edge | 89 | ES modules, import maps, module-type Service Workers |
| Firefox | 114 | module-type Service Workers (shipped Firefox 114) |
| Safari | 16.4 | import maps + module-type Service Workers |

Requirements: ES modules, import maps, module-type Service Workers,
`BroadcastChannel`, `fetch`, WebAssembly. IE is not supported.

## Known limitations

- **WebKit first-load transient error**: on the very first (uncontrolled)
  load, Safari may surface a "not a valid JavaScript MIME type" console error
  for a raw `.ts` request that happened before the SW took control. It
  disappears after the controlled activation reload and is not a failure.
- **iOS Safari / Android Chrome are not in CI.** The WebKit engine is tested
  (macOS), but on-device iOS/Android validation has not been automated yet.
  Report device-specific issues via the bug template.
- **`file://` and sandboxed iframes**: Service Workers are unavailable there.
  Rawscript falls back to a Blob-URL loader (see README, "Fallback"), which is
  slower and main-thread-bound.

## Verifying locally

```sh
pnpm build
pnpm --filter rawscript-cli build
npx playwright install --with-deps chromium firefox webkit
pnpm test:e2e
```