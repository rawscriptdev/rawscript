import { test, expect } from '@playwright/test'

const examples: Array<{
  name: string
  path: string
  locator: string
  altLocator?: string
  text: string | null
}> = [
  { name: 'react', path: '/examples/react/', locator: 'h1', text: 'rawscript + React' },
  { name: 'preact', path: '/examples/preact/', locator: 'h1', text: 'rawscript + Preact' },
  { name: 'solid', path: '/examples/solid/', locator: 'h1', text: 'rawscript + Solid' },
  { name: 'vue', path: '/examples/vue/', locator: 'h1', text: 'rawscript + Vue' },
  {
    name: 'three',
    path: '/examples/three/',
    locator: 'canvas',
    // Headless environments without WebGL (e.g. CI Firefox) get a graceful
    // fallback element instead of a rendering canvas.
    altLocator: '#webgl-unavailable',
    text: null,
  },
]

test.describe('framework examples render', () => {
  for (const ex of examples) {
    test(`${ex.name} example renders without page errors`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', (err) => pageErrors.push(err.message))

      await page.goto(ex.path)

      let target = page.locator(ex.locator)
      if (ex.altLocator) {
        target = target.or(page.locator(ex.altLocator))
      }

      if (ex.text) {
        await expect(target).toHaveText(ex.text, { timeout: 60_000 })
      } else {
        await expect(target).toBeVisible({ timeout: 60_000 })
      }

      // On the very first (uncontrolled) load the browser may attempt the
      // module fetch before boot's activation-reload takes over; WebKit
      // surfaces the transient "not a valid JavaScript MIME type" error for
      // that raw .ts response. It is expected and disappears after the reload.
      // Any other page error is a real failure.
      const transientMime = /not a valid JavaScript MIME type for module script/
      expect(pageErrors.filter((e) => !transientMime.test(e))).toEqual([])
    })
  }
})
