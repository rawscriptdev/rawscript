import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { importMapValue } from '../../packages/cli/src/deps.ts'

test('importMapValue: resolves relative to the project entry dir, not the cwd', () => {
  const entryDir = path.resolve('/project/app')
  const outFile = path.resolve('/project/app/.rawscript/deps/locallib.js')
  assert.equal(importMapValue(entryDir, outFile), './.rawscript/deps/locallib.js')
})

test('importMapValue: uses forward slashes on every platform', () => {
  const entryDir = path.resolve('/project/app')
  const outFile = path.resolve('/project/app/.rawscript/deps/@scope/pkg/index.js')
  assert.equal(importMapValue(entryDir, outFile), './.rawscript/deps/@scope/pkg/index.js')
})

test('importMapValue: escapes the output dir when it lives outside the entry dir', () => {
  const entryDir = path.resolve('/project/app')
  const outFile = path.resolve('/project/.rawscript/deps/locallib.js')
  assert.equal(importMapValue(entryDir, outFile), './../.rawscript/deps/locallib.js')
})

test('importMapValue: keeps the specifier subpath structure', () => {
  const entryDir = path.resolve('/project/app')
  const outFile = path.resolve('/project/app/.rawscript/deps/react-dom/client.js')
  assert.equal(importMapValue(entryDir, outFile), './.rawscript/deps/react-dom/client.js')
})