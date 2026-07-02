# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities privately via email to **security@rawscript.dev**. Do not open public issues for security vulnerabilities.

We aim to acknowledge reports within 48 hours and provide a remediation timeline within 7 days.

## Security Model

rawscript is a browser-based TypeScript compiler. Its security model assumes:

1. **Service Worker isolation**: The SW runs in a separate context with limited access to the page's DOM.
2. **Cache-first dependency cache**: Third-party dependencies (esm.sh, unpkg) are cached with hash verification (`fnv1a`). A poisoned response is rejected and refetched.
3. **Resource limits**: Pages can configure `maxSourceBytes`, `maxModules`, `maxCompileMs`, `maxCachedModules`. Values are clamped to hard ceilings; invalid/absent values fall back to defaults.
4. **Import map integrity**: Relative import map values are resolved against the page origin. Self-hosted dependencies (`./dep.js`) enter the cache-first dependency cache.
4. **CSP modes**:
   - `strict`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...` — self-hosted deployments
   - `default`: Adds `'unsafe-inline'` + `https://unpkg.com https://esm.sh` for zero-config CDN usage

## Guarantees

- **No RCE**: The SW only compiles TypeScript to JavaScript; no arbitrary code execution from user input.
- **No cache poisoning**: Dependency cache entries are hash-verified (`fnv1a`). A mismatch drops the entry and refetches.
- **No traversal**: Path traversal attempts (`../`, percent-encoded, mixed separators, NUL bytes, absolute paths, Windows drive-absolute, leading-backslash root) are rejected with 403/400.
- **Malformed input sanitization**: Junk postMessage payloads, wrong-typed importmap entries, and malformed percent-encoding are sanitized without breaking the worker.

## Limits Reference

| Limit | Default | Floor | Ceiling |
|-------|---------|-------|---------|
| `maxSourceBytes` | 2 MB | 1 KB | 50 MB |
| `maxModules` | 20,000 | 1,000 | 100,000 |
| `maxCompileMs` | 30,000 | 1,000 | 120,000 |
| `maxCachedModules` | 500 | 50 | 10,000 |

Values are clamped to `[floor, ceiling]`. Invalid/absent/NaN/Infinity values fall back to defaults.

## CSP Modes

| Mode | Use Case | Inline Scripts |
|------|----------|----------------|
| `strict` | Self-hosted, no CDN | Not allowed (use hashes/nonces) |
| `default` | Zero-config CDN (unpkg/esm.sh) | Allowed (`'unsafe-inline'`) |

## Supply Chain

- `pnpm audit` (high/critical) in CI
- `pnpm sbom` generates CycloneDX SBOM.json
- `release.yml`: tag↔version sync, SBOM artifact, `attest-build-provenance`, GH Release
- `publish.yml`: packed-contents verification, OIDC/provenance publishing

## Maintainer Checklist

- [ ] Dependency updates reviewed for security advisories
- [ ] SBOM generated and attached to release
- [ ] Build provenance attested
- [ ] npm publish uses OIDC + provenance
- [ ] Version tag signed