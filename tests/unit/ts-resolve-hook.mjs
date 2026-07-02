/**
 * ts-resolve-hook.mjs — in-process TypeScript resolution hook for unit tests
 *
 * Registers a custom resolver that mimics the SW's import map resolution
 * for node --test execution. Uses the same resolution logic as the SW.
 */

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const importMap = {
  imports: {
    'node:assert': 'node:assert',
    'node:module': 'node:module',
    'node:process': 'node:process',
  }
}

register(
  pathToFileURL(resolve(dirname(import.meta.url), './ts-resolve-hook.mjs')),
  {
    resolve(specifier, context, next) {
      if (specifier in importMap.imports) {
        return next(importMap.imports[specifier], context)
      }
      return next(specifier, context)
    }
  }
)