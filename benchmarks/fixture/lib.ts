import type { FormatOptions } from './types.ts'

export function format<T extends { toString(): string }>(value: T, options: FormatOptions = {}): string {
  const raw = value.toString()
  const padded = options.pad ? raw.padStart(options.pad, '0') : raw
  return options.upper ? padded.toUpperCase() : padded
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
