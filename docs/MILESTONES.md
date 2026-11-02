# Jewbot milestones

| ID | Status | Description |
|----|--------|-------------|
| **M0** | **COMPLETE** (scaffold) | Architecture + Electron/TS scaffold + module stubs + safety smoke |
| **M1** | **COMPLETE** | Ollama streaming chat in the Electron UI + agent `read_file` / `list_dir` (project jail, .gitignore) |
| **M2** | **COMPLETE** | Terminal streaming (stdout/stderr) + destructive-command confirmation UX |
| **M3** | **COMPLETE** | File edit + unified diff preview; apply only after Accept, with Undo |
| **M4** | **COMPLETE** | Context indexer: .gitignore-aware summary, find_files, search_context. Embeddings not required |
| **M5** | **COMPLETE** | SSH sessions via ssh2: allowlisted hosts, TOFU, streamed exec, destructive-command gate |
| **M6** | **COMPLETE** | Cascade runner UI + auto-advance across a local task queue |
| **M7** | **NEXT** | Packaging / releases |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).
M3 completed: 2026-10-23 (America/New_York).
M4 completed: 2026-10-23 (America/New_York).
M5 completed: 2026-11-02 (America/New_York).
M6 completed: 2026-11-02 (America/New_York).

**Next is M7** (packaging / releases). Cascade keeps a task queue in the open project's `.jewbot/cascade.json` (gitignored) and writes one receipt per finished task under `.jewbot/receipts/`. Start runs the next pending task through the local Ollama agent. When that task finishes cleanly, and its acceptance command exits 0 if one was set, the next pending task starts without waiting. A destructive command, a file edit, a secret read, an SSH host-key check, an SSH passphrase, or `ask_owner` marks that task blocked and is not approved by the model. The runner then continues with the next pending task. Stop aborts the current task. Pause finishes it and then waits. Paid providers stay off unless `JEWBOT_ALLOW_PAID=1`.

SSH sessions still connect only to hosts in `~/.jewbot/hosts.json` (or `JEWBOT_SSH_HOSTS`). The first connection shows the host-key fingerprint and stores it only after the owner confirms. File writes stay inside the open project, show a unified diff, and land only after Accept. Destructive shell commands stay soft-blocked until the owner confirms. Cascade does not click those confirms for you.

Tag `m3` on the M3 commit already on `main` (`git tag m3 && git push origin m3`), not on a feature branch. After M4 merges to `main`, tag that commit `m4` the same way. After M5 merges to `main`, tag that commit `m5` the same way. After M6 merges to `main`, tag that commit `m6` the same way. Do not tag the feature branch.
