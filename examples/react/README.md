# react

Reference application: React with JSX, no build step.

## What it shows

- JSX transpilation driven by `jsx`/`jsxImportSource` in `tsconfig.json`
  (React is the default JSX source when no import map overrides it).
- npm imports (`react`, `react-dom`) rewritten to esm.sh automatically.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/react/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts the heading renders with
zero page errors; `tests/jsx-equivalence.spec.ts` asserts the dev runtime and
the CLI production build use the same JSX semantics.