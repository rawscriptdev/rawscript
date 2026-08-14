# preact

Reference application: Preact with JSX via `preact/compat`.

## What it shows

- JSX configured through the HTML import map
  (`"react": "https://esm.sh/preact/compat"`).
- Stateful components and event handlers in the browser runtime.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/preact/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts the heading renders with
zero page errors.