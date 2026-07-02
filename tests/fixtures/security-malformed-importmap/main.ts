import { VALUE } from 'garbage'
import { VALUE as V2 } from 'alsonormal'

const out = document.querySelector<HTMLDivElement>('#out')!
out.textContent = `garbage-ok: ${VALUE + V2}`