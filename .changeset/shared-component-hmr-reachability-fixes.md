---
"@zintljs/compiler": patch
---

Fixed HMR updates for shared and lazy components by resolving entry manager chunks through boundary graph reachability traversal:

- Updated `getAffectedChunks` to map safe/sanitized boundary IDs back to their physical files.
- Performed depth-first reachability search to correctly track and invalidate entry managers for any component containing translations.
