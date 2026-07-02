// Triggers the broken.ts compile error via a dynamic import. The rejection is
// caught so no pageerror escapes — the error overlay (driven by the SW's
// TRANSPILE_ERROR message) is the only symptom.
import('./broken.ts').catch(() => {})