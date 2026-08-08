# Benchmarks

Rawscript's performance claims are **measured, not guessed** — the
benchmark suite (`benchmarks/run.mjs`, `pnpm bench`) measures the browser
runtime end-to-end with real Playwright Chromium plus the CLI production
build, and writes a full report to `benchmarks/results/` (gitignored).

The same suite runs in CI (`.github/workflows/ci.yml`, `bench` job), so a
broken benchmark fails the build — regressions are caught, not missed.

## Methodology (in short)

- **cold load**: caches cleared + SW unregistered; time from navigation
  start until the fixture renders. Includes SW install, esbuild-WASM
  download/init, and transpiling the 3-module fixture chain.
- **warm load**: same page reloaded; WASM + transpiled output already
  cached.
- **compile miss / hit**: in-page `fetch()` of a `.ts` module through the SW
  (miss = transpile + cache write; hit = source re-fetch + content
  fingerprint match + cache read). The page asserts the response was
  actually transpiled. Hits are intentionally not free: the SW re-fetches
  the source on every request so the fingerprint can prove freshness.
- **CLI build**: `rawscript build` on the fixture — wall-clock time + output
  size.
- Absolute numbers are machine-dependent; use them for **relative
  regressions** (same machine, same browser).

## Latest published baseline

Generated: 2026-08-18 (branch `58fc8e6`, Windows 11 x64, Node v24, headless
Chromium, 3 runs per metric). Machine: developer workstation.

| Metric | Median | Min | Max |
|---|---|---|---|
| Cold load (SW install + WASM init + compile) | 4532 ms | 4488 | 5483 |
| Warm load (cached) | 3 ms | 3 | 4 |
| Compile miss (single .ts through SW) | 11 ms | 10 | 15 |
| Compile hit (fingerprint check + cache serve) | 7 ms | 6 | 8 |
| Heap, fixture page (Chromium usedJSHeapSize) | 10 MB | — | — |

CLI production build (fixture): **350 ms**, 0.8 KB output (2 files).

## What the numbers say (honestly)

- First load is dominated by the ~8MB esbuild WASM download + initialization
  (~4.5s here; network-bound, varies wildly). It is cached by the SW on
  `install`, which is why **warm loads are 3 ms**.
- Per-file transpilation is 5-15 ms — esbuild is fast even in WASM mode.
- A cache hit is 7 ms, not 0 — that is the cost of the freshness guarantee
  (source re-fetch + fingerprint comparison). Rawscript deliberately chooses
  correctness over pretending hits are free.

## Re-running

```sh
pnpm build
pnpm --filter rawscript-cli build
pnpm bench          # writes benchmarks/results/baseline-<timestamp>.md
```

Compare a new report against the published baseline **on the same machine**
for relative regression tracking.