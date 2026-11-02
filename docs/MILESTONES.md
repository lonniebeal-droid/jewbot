# Jewbot milestones

| ID | Status | Description |
|----|--------|-------------|
| **M0** | **COMPLETE** (scaffold) | Architecture + Electron/TS scaffold + module stubs + safety smoke |
| **M1** | **COMPLETE** | Ollama streaming chat in the Electron UI + agent `read_file` / `list_dir` (project jail, .gitignore) |
| **M2** | **COMPLETE** | Terminal streaming (stdout/stderr) + destructive-command confirmation UX |
| **M3** | **COMPLETE** | File edit + unified diff preview; apply only after Accept, with Undo |
| **M4** | **COMPLETE** | Context indexer: .gitignore-aware summary, find_files, search_context. Embeddings not required |
| **M5** | **COMPLETE** | SSH sessions via ssh2: allowlisted hosts, TOFU, streamed exec, destructive-command gate |
| **M6** | **NEXT** | Cascade runner UI + auto-advance |
| M7 | pending | Packaging / releases |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).
M3 completed: 2026-10-23 (America/New_York).
M4 completed: 2026-10-23 (America/New_York).
M5 completed: 2026-11-02 (America/New_York).

**Next is M6** (cascade runner UI + auto-advance). SSH sessions connect only to hosts in `~/.jewbot/hosts.json` (or `JEWBOT_SSH_HOSTS`). The first connection shows the host-key fingerprint and stores it only after the owner confirms. `ssh_exec` streams stdout and stderr and uses the same one-shot destructive-command grant as the local terminal. Passphrases and passwords stay in memory for the session. The context index walks only the open project, honors `.gitignore` and default secret/binary ignores, and feeds the agent a compact tree plus a few excerpts. File writes stay inside the open project, show a unified diff, and land only after Accept. Secret paths (`.env`, keys) open only with that confirm. Destructive shell commands stay soft-blocked until the owner confirms.

Tag `m3` on the M3 commit already on `main` (`git tag m3 && git push origin m3`), not on a feature branch. After M4 merges to `main`, tag that commit `m4` the same way. After M5 merges to `main`, tag that commit `m5` the same way. Do not tag the feature branch.
