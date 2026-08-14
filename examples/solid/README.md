# solid

Reference application: Solid with JSX via `jsxImportSource`.

## What it shows

- `jsxImportSource: "solid-js"` in `tsconfig.json` driving the JSX
  transform (no import map override needed).
- Solid's fine-grained reactivity in the browser runtime.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/solid/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts the heading renders with
zero page errors; `tests/jsx-equivalence.spec.ts` asserts the dev runtime and
the CLI production build use the same JSX semantics.