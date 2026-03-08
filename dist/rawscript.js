"use strict";
(() => {
  // src/boot.ts
  var SW_PATH = "/rawscript-sw.js";
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(SW_PATH, { type: "module" }).then((reg) => {
      if (reg.installing) {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") {
            location.reload();
          }
        });
      }
    });
  }
})();
