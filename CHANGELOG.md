# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-30

### Security Hardening (Phase D — Roadmap Items 24–32)

#### Server Hardening (Item 24, 28)
- Path traversal matrix: rejects `../`, percent-encoded variants, double encoding, mixed separators, NUL bytes, absolute paths, Windows drive-absolute attempts, and leading-backslash root (`/\windows/win.ini`).
- Dotfiles (`.git`, `.env`, `.rawscript`, ...) and `node_modules` are never served.
- Symlink/junction escapes rejected via realpath containment.
- Malformed percent-encoding answered with 400, never a crash.
- Baseline security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Opt-in CSP via `--csp default|strict`; never imposed silently.
  - `strict`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`
  - `default`: adds `'unsafe-inline'` for script/style, allows `https://unpkg.com` and `https://esm.sh` for script/worker/connect (required because import maps are always inline in browsers).

#### Resource Limits (Item 25)
- Configurable per page via `window.rawscriptConfig.limits` with hard ceilings and floors:
  - `maxSourceBytes`: 1 KB – 50 MB (default 2 MB)
  - `maxModules`: 1,000 – 100,000 (default 20,000)
  - `maxCompileMs`: 1,000 – 120,000 (default 30,000)
  - `maxCachedModules`: 50 – 10,000 (default 500)
- Invalid/absent/NaN/Infinity values fall back to defaults.
- Structured diagnostic on limit exceeded (no silent failure).

#### Cache Poisoning & Malformed Input (Item 26)
- Dependency cache (`rawscript-deps-v1`) is cache-first with hash verification (fnv1a).
- Non-cachable dependency responses (e.g., HTML from poisoned upstream) return structured error modules instead of Firefox's "SW unexpected error".
- Import map values resolved against client URL — self-hosted deps (`./dep.js`) enter cache-first dep cache.
- Malformed percent-encoding in unresolved specifiers yields structured error module.
- Junk postMessage payloads and wrong-typed import map entries sanitized without breaking worker.

#### Import Map Handling (Item 27)
- Relative import map values resolved against client URL (page origin).
- External import maps unsupported in all engines — code reverted; strict fixtures use relative imports.
- Import map JSON served without charset parameter (Chromium strictness).

#### CSP Hardening (Item 28)
- `strict` mode: self-hosted pages render under strict CSP without violations.
- Error overlay renders and is dismissible under strict CSP (constructed stylesheets, no inline handlers).
- `default` mode allows unpkg/esm.sh for zero-config CDN usage.

#### Supply Chain (Items 29–31)
- `pnpm audit` (high/critical) in CI.
- `pnpm sbom` generates CycloneDX SBOM.json.
- `release.yml`: tag↔version sync, SBOM artifact, `attest-build-provenance`, GH Release with artifacts.
- `publish.yml`: packed-contents verification, OIDC/provenance publishing.

### Developer Experience
- `pnpm sbom` script + `@cyclonedx/cyclonedx-npm` dependency.
- `CONTRIBUTING.md` updated with release process.
- `SECURITY.md` comprehensive security documentation.
- `README.md` Security headers & CSP section + limits config reference.

### Testing
- 216/216 e2e tests pass across Chromium, Firefox, WebKit.
- 91/91 unit tests pass.
- Typecheck + build clean.

---

## [0.2.0] - 2026-07-01

(Previous release — pre-Phase D baseline)