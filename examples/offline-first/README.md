# offline-first

Reference application demonstrating rawscript's offline behavior
(roadmap: offline-first application).

## What it shows

- Local TypeScript modules (`main.tsx`, `lib.ts`) compiled by the Service
  Worker.
- An npm dependency (preact via esm.sh) served from the **cache-first
  dependency cache**.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/offline-first/
```

Load the page once, then reload with esm.sh and unpkg unreachable — the page
still renders. After the first successful load, an already-loaded module
graph keeps working offline; a dependency that was never loaded cannot be
served offline (load once online first).

## Verified in CI

`tests/examples.spec.ts` loads the example, then reloads it with
`esm.sh`/`unpkg` requests aborted and asserts it still renders with zero page
errors.