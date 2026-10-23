# Jewbot milestones

| ID | Status | Description |
|----|--------|-------------|
| **M0** | **COMPLETE** (scaffold) | Architecture + Electron/TS scaffold + module stubs + safety smoke |
| **M1** | **COMPLETE** | Ollama streaming chat in the Electron UI + agent `read_file` / `list_dir` (project jail, .gitignore) |
| **M2** | **COMPLETE** | Terminal streaming (stdout/stderr) + destructive-command confirmation UX |
| **M3** | **COMPLETE** | File edit + unified diff preview; apply only after Accept, with Undo |
| **M4** | **NEXT** | Context indexer quality (embeddings optional, still local) |
| M5 | pending | SSH sessions via ssh2 |
| M6 | pending | Cascade runner UI + auto-advance |
| M7 | pending | Packaging / releases |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).
M3 completed: 2026-10-23 (America/New_York).

**Next is M4** (context indexer: `.gitignore`-aware project summary, embeddings optional and still local). SSH sessions are **M5**. File writes stay inside the open project, show a unified diff, and land only after Accept. Secret paths (`.env`, keys) open only with that confirm. Destructive shell commands stay soft-blocked until the owner confirms.

After M3 merges to `main`, tag that commit `m3` (`git tag m3 && git push origin m3`). Do not tag the feature branch.
