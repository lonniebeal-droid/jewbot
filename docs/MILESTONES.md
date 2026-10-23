# Jewbot milestones

| ID | Status | Description |
|----|--------|-------------|
| **M0** | **COMPLETE** (scaffold) | Architecture + Electron/TS scaffold + module stubs + safety smoke |
| **M1** | **COMPLETE** | Ollama streaming chat in the Electron UI + agent `read_file` / `list_dir` (project jail, .gitignore) |
| **M2** | **NEXT** | Terminal streaming + destructive detection UX |
| M3 | pending | File edit + diff preview apply flow |
| M4 | pending | Context indexer quality (embeddings optional, still local) |
| M5 | pending | SSH sessions via ssh2 |
| M6 | pending | Cascade runner UI + auto-advance |
| M7 | pending | Packaging / releases |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).

After M1 merges to `main`, tag that commit `m1` (`git tag m1 && git push origin m1`). Do not tag the feature branch.
