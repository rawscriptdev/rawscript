/**
 * hash.ts — tiny deterministic hash (FNV-1a 32-bit) for cache fingerprints
 *
 * Used to version cache entries against configuration changes (JSX options,
 * importmap, tsconfig). Not security-sensitive — it only needs to change when
 * the effective transform configuration changes.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
