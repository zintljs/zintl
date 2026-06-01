---
"@zintl/compiler": patch
---

Upgrade the Zintl compiler to fully support backing up, restoring, and similarity matching (fuzzy reconciliation) of static translation assets in the global Hive:

- **Move & Rename Auto-Recovery**: Stored asset targets indexed by their source content hash (`@zintl/asset-hash:<sha1>`) instead of absolute paths. This allows automatic translation restoration at the new location when a source asset is moved or renamed.
- **Binary/Image Asset Backups**: Implemented Base64 encoding/decoding to safely back up localized binary assets in `hive.json` and restore them back as raw binary buffers.
- **Target Pruning**: Updated the asset manager to proactively delete localized target files from disk when their source asset is deleted or moved, working seamlessly in development/HMR mode.
- **Fuzzy Modification Reconciliation**: Implemented Levenshtein-based similarity matching for text and Markdown assets. If a source asset changes slightly (either at the same path or during a move), Zintl now preserves the translator's existing translation and prepends a review warning rather than overwriting it entirely.
