import { test, expect } from '@playwright/test'

const examples: Array<{ name: string; path: string; locator: string; text: string | null }> = [
  { name: 'react', path: '/examples/react/', locator: 'h1', text: 'rawscript + React' },
  { name: 'preact', path: '/examples/preact/', locator: 'h1', text: 'rawscript + Preact' },
  { name: 'solid', path: '/examples/solid/', locator: 'h1', text: 'rawscript + Solid' },
  { name: 'vue', path: '/examples/vue/', locator: 'h1', text: 'rawscript + Vue' },
  { name: 'three', path: '/examples/three/', locator: 'canvas', text: null },
]

test.describe('framework examples render', () => {
  for (const ex of examples) {
    test(`${ex.name} example renders without page errors`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', (err) => pageErrors.push(err.message))

      await page.goto(ex.path)

      if (ex.text) {
        await expect(page.locator(ex.locator)).toHaveText(ex.text, { timeout: 60_000 })
      } else {
        await expect(page.locator(ex.locator)).toBeVisible({ timeout: 60_000 })
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
