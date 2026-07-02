import { test, expect } from '@playwright/test'

test.describe('importmap JSX detection', () => {
  test('tsx is transpiled with the automatic JSX runtime (react default)', async ({ page }) => {
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/examples/react/App.tsx')) {
        const ct = response.headers()['content-type'] ?? ''
        if (ct.includes('application/javascript')) {
          response
            .text()
            .then((body) => swBodies.push(body))
            .catch(() => {
              // navigation raced the body read — page reload is expected
            })
        }
      }
    })

    await page.goto('/examples/react/')

    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(swBodies.some((b) => b.includes('react/jsx-runtime'))).toBe(true)
    expect(swBodies.some((b) => b.includes('react-dom/client'))).toBe(true)
  })

  test('plain ts is not JSX-transformed', async ({ page }) => {
    const swBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/examples/vanilla/main.ts')) {
        const ct = response.headers()['content-type'] ?? ''
        if (ct.includes('application/javascript')) {
          response
            .text()
            .then((body) => swBodies.push(body))
            .catch(() => {
              // navigation raced the body read — page reload is expected
            })
        }
      }
    })

    await page.goto('/examples/vanilla/')
    await expect(page.locator('h1')).toHaveText('rawscript works', { timeout: 60_000 })

    await expect.poll(() => swBodies.length, { timeout: 60_000 }).toBeGreaterThan(0)
    expect(swBodies.every((b) => !b.includes('jsx-runtime'))).toBe(true)
  })
})
