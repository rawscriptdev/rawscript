// External config for strict CSP test — verifies that external config.js
// still works under strict CSP (no inline script needed).
window.rawscriptConfig = {
  cdn: { enabled: false },
}