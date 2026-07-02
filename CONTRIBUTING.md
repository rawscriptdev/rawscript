# Contributing to rawscript

Thanks for your interest in contributing! This document outlines the process for contributing to the project.

## Development Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test:unit
pnpm test:e2e
```

## Release Process

1. **Version bump**: Update `package.json` version to the new release version.
2. **Build**: Run `pnpm build` to ensure everything compiles.
3. **SBOM**: Run `pnpm sbom` to generate the Software Bill of Materials.
4. **Create release**: Use the "Release" workflow in GitHub Actions:
   - Go to Actions → Release → Run workflow
   - Enter the version (e.g., `0.3.0`)
   - This will:
     - Verify version sync with package.json
     - Build the project
     - Generate SBOM
     - Attest build provenance
     - Create GitHub Release with artifacts
5. **Publish to npm**: The "Publish" workflow triggers automatically on release:
   - Verifies packed contents
   - Publishes to npm with OIDC provenance

## Testing

- Unit tests: `pnpm test:unit`
- E2E tests: `pnpm test:e2e` (runs Chromium, Firefox, WebKit)
- TypeScript check: `pnpm typecheck`

## Code Style

- Run `pnpm typecheck` before committing
- No lint step currently configured

## Security

See [SECURITY.md](SECURITY.md) for the security model and reporting process.