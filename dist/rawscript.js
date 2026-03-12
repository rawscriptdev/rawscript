"use strict";
(() => {
  // src/boot.ts
  var SW_PATH = "/rawscript-sw.js";
  function sendImportmapToSW(sw) {
    const importmapEl = document.querySelector('script[type="importmap"]');
    if (!importmapEl)
      return;
    try {
      const importmap = JSON.parse(importmapEl.textContent || "{}");
      sw.postMessage({ type: "IMPORTMAP", importmap: importmap.imports ?? {} });
    } catch {
    }
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(SW_PATH, { type: "module" }).then((reg) => {
      if (reg.active) {
        sendImportmapToSW(reg.active);
      }
      if (reg.installing) {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") {
            sendImportmapToSW(e.target);
            location.reload();
          }
        });
      }
    });
  }
})();
