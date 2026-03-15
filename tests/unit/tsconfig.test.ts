import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTsConfig,
  getJsxOptionsFromTsconfig,
  applyPaths,
  unsupportedOptionWarnings,
} from '../../packages/runtime/src/tsconfig.ts'
import { fnv1a } from '../../packages/runtime/src/hash.ts'

test('parseTsConfig: parses valid JSON', () => {
  const tsconfig = parseTsConfig('{ "compilerOptions": { "jsx": "react-jsx" } }')
  assert.equal(tsconfig.compilerOptions.jsx, 'react-jsx')
  assert.equal(tsconfig.dir, '')
})

test('parseTsConfig: tolerates // and /* */ comments', () => {
  const tsconfig = parseTsConfig(
    '{ // line comment\n "compilerOptions": { /* block */ "paths": { "@a/*": ["./a/*"] } } }'
  )
  assert.deepEqual(tsconfig.compilerOptions.paths, { '@a/*': ['./a/*'] })
})

test('parseTsConfig: does not strip comments inside string values', () => {
  const tsconfig = parseTsConfig('{ "compilerOptions": { "baseUrl": "http://x.example/y" } }')
  assert.equal(tsconfig.compilerOptions.baseUrl, 'http://x.example/y')
})

test('parseTsConfig: throws with a descriptive message on invalid JSON', () => {
  assert.throws(() => parseTsConfig('{ "compilerOptions": {'), /not valid JSON/)
})

test('parseTsConfig: throws when the root is not an object', () => {
  assert.throws(() => parseTsConfig('[]'), /must contain an object/)
})

test('parseTsConfig: tolerates a missing compilerOptions', () => {
  const tsconfig = parseTsConfig('{ "extends": "./base.json" }')
  assert.deepEqual(tsconfig.compilerOptions, {})
})

test('getJsxOptionsFromTsconfig: null when no JSX settings exist', () => {
  assert.equal(getJsxOptionsFromTsconfig(parseTsConfig('{ "compilerOptions": {} }')), null)
})

test('getJsxOptionsFromTsconfig: react-jsx maps to the automatic runtime', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "react-jsx" } }')
  )
  assert.deepEqual(options, { jsx: 'automatic', jsxImportSource: 'react' })
})

test('getJsxOptionsFromTsconfig: jsxImportSource is honored', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "preact" } }')
  )
  assert.deepEqual(options, { jsx: 'automatic', jsxImportSource: 'preact' })
})

test('getJsxOptionsFromTsconfig: react-jsxdev enables jsxDev', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "react-jsxdev" } }')
  )
  assert.deepEqual(options, { jsx: 'automatic', jsxImportSource: 'react', jsxDev: true })
})

test('getJsxOptionsFromTsconfig: react maps to the classic transform', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" } }')
  )
  assert.deepEqual(options, { jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment' })
})

test('getJsxOptionsFromTsconfig: preserve is passed through', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "preserve" } }')
  )
  assert.deepEqual(options, { jsx: 'preserve' })
})

test('getJsxOptionsFromTsconfig: unknown jsx value normalizes to automatic', () => {
  const options = getJsxOptionsFromTsconfig(
    parseTsConfig('{ "compilerOptions": { "jsx": "reactx" } }')
  )
  assert.deepEqual(options, { jsx: 'automatic', jsxImportSource: 'react' })
})

test('applyPaths: exact pattern match resolves to a relative specifier', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "exact": ["./src/exact"] } } }',
    '/project'
  )
  assert.equal(applyPaths('exact', tsconfig, '/project/main.ts'), './src/exact.ts')
})

test('applyPaths: wildcard pattern captures and substitutes', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["./src/*"] } } }'
  )
  assert.equal(applyPaths('@lib/util', tsconfig, '/src/app/main.ts'), '../util.ts')
})

test('applyPaths: wildcard resolves relative to the importer at the root', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["./src/*"] } } }'
  )
  assert.equal(applyPaths('@lib/util', tsconfig, '/main.ts'), './src/util.ts')
})

test('applyPaths: wildcard with suffix pattern', () => {
  const tsconfig = parseTsConfig('{ "compilerOptions": { "paths": { "@/*/mod": ["./libs/*/mod"] } } }')
  assert.equal(applyPaths('@/app/mod', tsconfig, '/src/main.ts'), '../libs/app/mod.ts')
})

test('applyPaths: keeps an explicit extension in the target', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["./src/*"] } } }',
    '/project'
  )
  assert.equal(applyPaths('@lib/theme.css', tsconfig, '/project/app/main.ts'), '../src/theme.css')
})

test('applyPaths: no baseUrl resolves relative to the tsconfig directory', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "paths": { "@lib/*": ["./src/*"] } } }',
    '/project'
  )
  assert.equal(applyPaths('@lib/util', tsconfig, '/project/app/main.ts'), '../src/util.ts')
})

test('applyPaths: first matching pattern wins (declaration order)', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["./shared/*"], "@lib/special/*": ["./special/*"] } } }'
  )
  assert.equal(applyPaths('@lib/special/x', tsconfig, '/src/app/main.ts'), '../../shared/special/x.ts')
})

test('applyPaths: no match returns null', () => {
  const tsconfig = parseTsConfig('{ "compilerOptions": { "paths": { "@lib/*": ["./src/*"] } } }')
  assert.equal(applyPaths('react', tsconfig, '/src/app/main.ts'), null)
})

test('applyPaths: returns null when no paths are configured', () => {
  const tsconfig = parseTsConfig('{ "compilerOptions": { "baseUrl": "." } }')
  assert.equal(applyPaths('anything', tsconfig, '/src/main.ts'), null)
})

test('applyPaths: empty wildcard match is valid', () => {
  const tsconfig = parseTsConfig(
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib*": ["./src/lib*"] } } }'
  )
  assert.equal(applyPaths('@lib', tsconfig, '/src/app/main.ts'), '../lib.ts')
})

test('unsupportedOptionWarnings: flags verbatimModuleSyntax', () => {
  const warnings = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "verbatimModuleSyntax": true } }')
  )
  assert.ok(warnings.some((w) => w.option === 'verbatimModuleSyntax'))
})

test('unsupportedOptionWarnings: flags importsNotUsedAsValues preserve', () => {
  const warnings = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "importsNotUsedAsValues": "preserve" } }')
  )
  assert.ok(warnings.some((w) => w.option === 'importsNotUsedAsValues'))
})

test('unsupportedOptionWarnings: flags non-ESM module settings', () => {
  const warnings = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "module": "commonjs" } }')
  )
  assert.ok(warnings.some((w) => w.option === 'module' && w.message.includes('always ESM')))
})

test('unsupportedOptionWarnings: flags node16/nodenext moduleResolution', () => {
  const warnings = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "moduleResolution": "nodenext" } }')
  )
  assert.ok(warnings.some((w) => w.option === 'moduleResolution'))
})

test('unsupportedOptionWarnings: flags jsx preserve and unknown jsx values', () => {
  const preserve = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "jsx": "preserve" } }')
  )
  assert.ok(preserve.some((w) => w.option === 'jsx' && w.message.includes('preserve')))
  const unknown = unsupportedOptionWarnings(
    parseTsConfig('{ "compilerOptions": { "jsx": "reactx" } }')
  )
  assert.ok(unknown.some((w) => w.option === 'jsx' && w.message.includes('not a recognized value')))
})

test('unsupportedOptionWarnings: supported settings produce no warnings', () => {
  const warnings = unsupportedOptionWarnings(
    parseTsConfig(
      '{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "preact", "baseUrl": ".", "paths": { "a": ["./b"] } } }'
    )
  )
  assert.deepEqual(warnings, [])
})

test('fnv1a: deterministic and sensitive to input', () => {
  assert.equal(fnv1a('a'), fnv1a('a'))
  assert.notEqual(fnv1a('a'), fnv1a('b'))
  assert.match(fnv1a('anything'), /^[0-9a-f]{8}$/)
})
