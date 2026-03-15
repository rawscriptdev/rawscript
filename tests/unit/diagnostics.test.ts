import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractErrorLocation,
  classifyError,
  fixForError,
  codeFrame,
  buildCompileDiagnostic,
} from '../../packages/runtime/src/diagnostics.ts'

test('extractErrorLocation: parses file:line:column prefixes', () => {
  assert.deepEqual(extractErrorLocation('main.ts:4:10: ERROR: Syntax error'), {
    line: 4,
    column: 10,
  })
  assert.deepEqual(extractErrorLocation('no location here'), { line: 0, column: 0 })
})

test('classifyError: JSX errors get the JSX category', () => {
  assert.equal(
    classifyError('App.tsx:2:5: ERROR: The JSX syntax extension is not currently enabled'),
    'JSX configuration error'
  )
})

test('classifyError: resolution errors get the resolution category', () => {
  assert.equal(
    classifyError('main.ts:1:20: ERROR: Could not resolve "not-a-package"'),
    'Module resolution error'
  )
})

test('classifyError: syntax errors get the syntax category', () => {
  assert.equal(classifyError('main.ts:3:5: ERROR: Syntax error'), 'Syntax error')
})

test('fixForError: JSX hint mentions .tsx and tsconfig', () => {
  const fix = fixForError('App.ts:1:1: ERROR: The JSX syntax extension is not currently enabled')
  assert.match(fix, /\.tsx/)
  assert.match(fix, /tsconfig\.json/)
})

test('fixForError: resolution hint mentions the importmap', () => {
  const fix = fixForError('main.ts:1:8: ERROR: Could not resolve "react"')
  assert.match(fix, /importmap/)
})

test('fixForError: export hint points at the export list', () => {
  const fix = fixForError('main.ts:1:8: ERROR: No matching export in "lib.ts"')
  assert.match(fix, /export/)
})

test('codeFrame: marks the error line with > and caret at column', () => {
  const frame = codeFrame('line1\nline2 with error\nline3\nline4\nline5', 2, 10)
  assert.match(frame, /> 2 │ line2 with error/)
  assert.match(frame, /^>\s+│\s+\^/m)
  assert.doesNotMatch(frame, /> 1 │/)
})

test('buildCompileDiagnostic: answers WHAT/WHERE/WHY/HOW', () => {
  const diag = buildCompileDiagnostic({
    file: '/src/app.ts',
    message: '/src/app.ts:3:7: ERROR: Could not resolve "react"',
    source: 'a\nb\nc\nd',
    chain: ['/src/app.ts', '/src/index.ts'],
  })
  assert.equal(diag.file, '/src/app.ts')
  assert.equal(diag.line, 3)
  assert.equal(diag.column, 7)
  assert.equal(diag.category, 'Module resolution error')
  assert.match(diag.fix, /importmap/)
  assert.ok(diag.frame.length > 0)
  assert.deepEqual(diag.chain, ['/src/app.ts', '/src/index.ts'])
})

test('buildCompileDiagnostic: missing source produces no frame but still works', () => {
  const diag = buildCompileDiagnostic({ file: '/a.ts', message: 'broken' })
  assert.equal(diag.frame, '')
  assert.equal(diag.line, 0)
  assert.equal(diag.chain.length, 1)
})
