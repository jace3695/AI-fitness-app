# Existing local JSON backup: scope disclosure

The existing exporter reads only the browser's `ai-fitness-*` localStorage
domain through `readLocalCloudState`. It does not fetch cloud-only database
rows, Storage objects, Live records, separate recovery stores or IndexedDB.
The supplied original voice/material backups are separate assets and do not
establish that this JSON exporter can restore the complete platform.

The panel now labels the supported local workout/diet domain and explicitly
lists exclusions. It retains the existing version-1 JSON format and merge
behavior. Export also checks the existing 5 MiB import limit before creating a
download; an oversized export reports that no file was made and leaves records
unchanged. It no longer silently produces a file this importer rejects.

Three tests exercise the shipping component: rendered scope labels, unchanged
valid JSON download without mutations, and oversized rejection without data
loss. Real browser/download and device backup/restore remain separate gates.

A unified owner-verified cloud/blob/recovery backup is not implemented here.
It requires a separate restore contract for ownership, conflicts, reset
generations, source files and immutable pending requests. Never treat ordinary
JSON merging as safe replay of a saved network request.
