# Security Guide

Rawscript's security posture is **tested, not just documented** — the e2e
suite (`tests/security.spec.ts`) verifies every guarantee below against real
browsers. See [`SECURITY.md`](../SECURITY.md) for the vulnerability policy.

## Guarantees (with tests)

| Guarantee | How it works | Test |
|---|---|---|
| No RCE | The SW only compiles TypeScript to JavaScript; the compiler runs in a Web Worker | full e2e suite |
| No cache poisoning | Dependency cache entries are verified by content hash (fnv1a) on every read; a poisoned/mismatched body is rejected, deleted, and refetched — never served | `dependency cache poisoning defense` |
| No path traversal | `../`, percent-encoded, mixed separators, NUL bytes, absolute and Windows drive-absolute paths, leading-backslash root are rejected (403/400) | `traversal` tests |
| Malformed input sanitization | Junk `postMessage` payloads, wrong-typed import map entries, malformed percent-encoding are sanitized without breaking the worker | security suite |
| Strict CSP by default on preview | `rawscript preview` serves the strict CSP + baseline security headers exactly as a deployment would | `strict CSP deployment` |

## The dependency cache

Third-party modules (import map values, e.g. esm.sh URLs) are cached
cache-first so an already-loaded graph survives network loss. Every cache
read verifies the body against the stored hash; a mismatch drops the entry
and refetches. The browser HTTP cache is deliberately bypassed for sources
(`cache: 'no-store'`) plus a cache-busting query parameter and conditional
header stripping on SW fetches, so the SW — not the HTTP cache — is the
authority for what gets compiled.

## CSP modes

The dev/preview server (`scripts/serve.mjs`) sends a Content-Security-Policy
via `RAWSCRIPT_CSP=default|strict` (default `off` — it is a dev server).

- `strict`: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`; …
  — for self-hosted deployments with vendored assets
  (`rawscript vendor`).
- `default`: adds `'unsafe-inline'` + `https://unpkg.com https://esm.sh` for
  the zero-config CDN experience.

A deployment serves exactly what `rawscript preview` serves, so the preview
round-trip doubles as a CSP smoke test.

## Strict resolution mode

`window.rawscriptConfig = { cdn: { enabled: false } }` makes resolution
strict: a bare import with no import map entry becomes a structured
`Module resolution error` instead of a silent CDN fetch. Pair it with
`rawscript deps` (local import map) or `rawscript build --local-deps`
(bundled output) for fully self-contained deployments.

## Supply chain

- The runtime (`packages/runtime`) has **zero dependencies** —
  `"dependencies": {}` is an enforced invariant.
- Production builds externalize or bundle npm dependencies through
  npm/pnpm as the dependency authority — rawscript never ships its own
  package manager.
- `pnpm audit --prod --audit-level high` runs in CI on every commit.

## Reporting

Vulnerabilities: **security@rawscript.dev** (private, acknowledged within
48h). Do not open public issues for security problems. Responsible
disclosure, no embargo games — we will credit reporters in the release notes
unless anonymity is requested.