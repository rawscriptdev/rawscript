import { format, median } from './lib.ts'
import type { BenchmarkStats } from './types.ts'

const stats: BenchmarkStats = { label: 'rawscript-bench', median: 42 }

const title = document.createElement('h1')
title.id = 'bench-title'
title.textContent = format(stats.label, { upper: true })

const info = document.createElement('pre')
info.id = 'bench-info'
info.textContent = JSON.stringify({ label: stats.label, median: median([1, 2, 3, 4, 5]) })

document.body.appendChild(title)
document.body.appendChild(info)
document.body.dataset.ready = '1'
