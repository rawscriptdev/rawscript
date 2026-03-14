import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewriteImports } from '../../packages/runtime/src/resolver.ts'

const cases: Array<[string, string]> = [
  // bare specifiers → esm.sh
  ["import { useState } from 'react'", "import { useState } from 'https://esm.sh/react'"],
  [
    'import { useState } from "react"',
    'import { useState } from "https://esm.sh/react"',
  ],
  [
    "import { createRoot } from 'react-dom/client'",
    "import { createRoot } from 'https://esm.sh/react-dom/client'",
  ],
  [
    "import React from 'react@18.3.1'",
    "import React from 'https://esm.sh/react@18.3.1'",
  ],
  [
    "import { signal } from '@preact/signals-core'",
    "import { signal } from 'https://esm.sh/@preact/signals-core'",
  ],
  // dynamic and side-effect imports
  ["import('lazy')", "import('https://esm.sh/lazy')"],
  ["import ( 'lazy' )", "import ( 'https://esm.sh/lazy' )"],
  ["import 'side-effect'", "import 'https://esm.sh/side-effect'"],
  // never touch relative, absolute, or URL specifiers
  ["import { a } from './relative'", "import { a } from './relative'"],
  ["import { a } from '../up'", "import { a } from '../up'"],
  ["import { a } from '/abs'", "import { a } from '/abs'"],
  ["import('./relative')", "import('./relative')"],
  ["import { a } from 'https://x.example/y'", "import { a } from 'https://x.example/y'"],
  // commented-out imports must not be rewritten
  ["// import { a } from 'react'", "// import { a } from 'react'"],
  // import-looking text inside strings must not be rewritten
  ['const x = "from \'react\' in a string"', 'const x = "from \'react\' in a string"'],
  ["const x = 'import \"react\" here'", "const x = 'import \"react\" here'"],
  ['const x = `from "react" in template`', 'const x = `from "react" in template`'],
]

for (const [input, expected] of cases) {
  test(`rewriteImports: ${input}`, () => {
    assert.equal(rewriteImports(input), expected)
  })
}

test('rewriteImports: importmap-mapped specifiers are left alone', () => {
  const input = "import { a } from 'react'"
  const map = { react: 'https://cdn.example.com/react.js' }
  assert.equal(rewriteImports(input, map), input)
})

test('rewriteImports: unmapped specifiers are rewritten even when a map exists', () => {
  const input = "import { a } from 'solid-js'"
  const map = { react: 'https://cdn.example.com/react.js' }
  assert.equal(rewriteImports(input, map), "import { a } from 'https://esm.sh/solid-js'")
})

test('rewriteImports: multiple imports in one statement', () => {
  const input = "import React, { useState } from 'react'"
  assert.equal(rewriteImports(input), "import React, { useState } from 'https://esm.sh/react'")
})

test('rewriteImports: multiple statements and line offsets preserved', () => {
  const input = "import { a } from 'pkg-a'\nimport { b } from 'pkg-b'\nconsole.log(a, b)"
  assert.equal(
    rewriteImports(input),
    "import { a } from 'https://esm.sh/pkg-a'\nimport { b } from 'https://esm.sh/pkg-b'\nconsole.log(a, b)"
  )
})

test('rewriteImports: only the specifier is replaced, never the quote or context', () => {
  const input = "import { x as y } from 'pkg-a'"
  assert.equal(rewriteImports(input), "import { x as y } from 'https://esm.sh/pkg-a'")
})
