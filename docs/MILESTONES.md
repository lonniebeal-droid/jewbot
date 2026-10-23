# Jewbot milestones

| ID | Status | Description |
|----|--------|-------------|
| **M0** | **COMPLETE** (scaffold) | Architecture + Electron/TS scaffold + module stubs + safety smoke |
| **M1** | **COMPLETE** | Ollama streaming chat in the Electron UI + agent `read_file` / `list_dir` (project jail, .gitignore) |
| **M2** | **COMPLETE** | Terminal streaming (stdout/stderr) + destructive-command confirmation UX |
| **M3** | **NEXT** | File edit + diff preview apply flow |
| M4 | pending | Context indexer quality (embeddings optional, still local) |
| M5 | pending | SSH sessions via ssh2 |
| M6 | pending | Cascade runner UI + auto-advance |
| M7 | pending | Packaging / releases |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).

**Next is M3** (file edit + diff preview apply). SSH sessions are **M5**, not part of M2 — M2 only streams a local shell whose cwd is the open project. Destructive commands stay soft-blocked until the owner confirms; nothing in M2 auto-approves them.

After M2 merges to `main`, tag that commit `m2` (`git tag m2 && git push origin m2`). Do not tag the feature branch.
