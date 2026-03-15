/**
 * version.ts — version constants shared by page and Service Worker
 *
 * RAWSCRIPT_VERSION is the runtime version and must be kept in sync with
 * package.json. SW_PROTOCOL_VERSION is the page<->SW message protocol: bump
 * only when message semantics change incompatibly (see roadmap section 15).
 * A mismatch triggers a full cache reset + reload instead of undefined
 * behavior.
 */
export const RAWSCRIPT_VERSION = '0.2.0'
export const SW_PROTOCOL_VERSION = 1
