export const VALUE = 42

const out = document.querySelector<HTMLDivElement>('#out')!
out.textContent = `limits-ok: ${VALUE}`