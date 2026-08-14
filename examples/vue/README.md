# vue

Reference application: Vue Composition API in TypeScript.

## What it shows

- Vue without `.vue` SFC files: `defineComponent` + the Composition API in
  plain `.ts`, rendered with `h()`.
- How rawscript handles a framework that does not use JSX.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/vue/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts the heading renders with
zero page errors.