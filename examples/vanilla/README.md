# vanilla

Minimal reference application: plain TypeScript, no framework, no import
map, no build step.

## What it shows

- Zero-config setup: a `<script src>` and a `<script type="module">` is the
  entire application.
- TypeScript syntax (type annotations) transpiled in the browser.

## Try it

```sh
pnpm build && pnpm serve
# open http://localhost:3000/examples/vanilla/
```

## Verified in CI

`tests/examples.spec.ts` loads the page and asserts the heading renders with
zero page errors.