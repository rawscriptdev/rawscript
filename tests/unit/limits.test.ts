import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLimits, DEFAULT_LIMITS, FLOORS, HARD_CEILINGS } from '../../packages/runtime/src/limits.ts'

test('parseLimits returns defaults for absent/NaN/Infinity/invalid input', () => {
  assert.deepEqual(parseLimits(undefined), DEFAULT_LIMITS)
  assert.deepEqual(parseLimits(null), DEFAULT_LIMITS)
  assert.deepEqual(parseLimits(NaN), DEFAULT_LIMITS)
  assert.deepEqual(parseLimits(Infinity), DEFAULT_LIMITS)
  assert.deepEqual(parseLimits('not an object'), DEFAULT_LIMITS)
  assert.deepEqual(parseLimits([1, 2, 3]), DEFAULT_LIMITS)
})

test('parseLimits clamps values to [floor, ceiling]', () => {
  // Below floor -> clamps up to floor
  assert.equal(parseLimits({ maxSourceBytes: 0 }).maxSourceBytes, FLOORS.maxSourceBytes)
  assert.equal(parseLimits({ maxModules: -5 }).maxModules, FLOORS.maxModules)
  assert.equal(parseLimits({ maxCompileMs: 100 }).maxCompileMs, FLOORS.maxCompileMs)
  assert.equal(parseLimits({ maxCachedModules: 1 }).maxCachedModules, FLOORS.maxCachedModules)

  // Above ceiling -> clamps down to ceiling
  assert.equal(parseLimits({ maxSourceBytes: 100_000_000 }).maxSourceBytes, HARD_CEILINGS.maxSourceBytes)
  assert.equal(parseLimits({ maxModules: 200_000 }).maxModules, HARD_CEILINGS.maxModules)
  assert.equal(parseLimits({ maxCompileMs: 200_000 }).maxCompileMs, HARD_CEILINGS.maxCompileMs)
  assert.equal(parseLimits({ maxCachedModules: 20_000 }).maxCachedModules, HARD_CEILINGS.maxCachedModules)

  // Within range -> accepts value (floored)
  assert.equal(parseLimits({ maxSourceBytes: 1234.9 }).maxSourceBytes, 1234)
  assert.equal(parseLimits({ maxModules: 5000 }).maxModules, 5000)
})

test('parseLimits ignores unknown properties', () => {
  const result = parseLimits({ maxSourceBytes: 4096, unknownProp: 123 })
  assert.equal(result.maxSourceBytes, 4096)
  assert.equal('unknownProp' in result, false)
})

test('resource-limits fixture: config below floor clamps to floor (1024)', () => {
  // The security-limits fixture sets maxSourceBytes=1024 (the floor), so a
  // ~5.6 KB source must be rejected by the SW's Content-Length check.
  const limits = parseLimits({ maxSourceBytes: 1024 })
  assert.equal(limits.maxSourceBytes, 1024)
  assert.ok(limits.maxSourceBytes < 5600)
})