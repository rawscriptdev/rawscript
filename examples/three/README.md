# three

Reference application: Three.js, a large third-party dependency graph.

## What it shows

- Importing a large npm package (`three`) through the dependency cache.
- Graceful degradation when WebGL is unavailable (headless CI gets a
  `#webgl-unavailable` fallback element instead of a rendering canvas).

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/three/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts either the canvas or the
graceful fallback is visible with zero page errors.