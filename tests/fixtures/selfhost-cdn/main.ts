import ms from 'ms'

const out = document.querySelector<HTMLDivElement>('#out')!
out.textContent = `ms: ${ms('1h')}`