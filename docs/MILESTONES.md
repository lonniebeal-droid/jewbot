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
| **M7** | **COMPLETE** | Unsigned installers: macOS dmg/zip (arm64+x64), Linux AppImage+deb (x64+arm64), Windows NSIS (x64). Signing off |
| **M8** | **NEXT** | Multi-model routing across the owner's LAN Ollama hosts (Mac, Dell, Pi) with health checks |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).
M3 completed: 2026-10-23 (America/New_York).
M4 completed: 2026-10-23 (America/New_York).
M5 completed: 2026-11-02 (America/New_York).
M6 completed: 2026-11-02 (America/New_York).
M7 completed: 2026-11-06 (America/New_York).

**Next is M8** (multi-model routing). The owner already has Ollama on more than one machine (Mac, Dell, Raspberry Pi). M8 should keep the $0 gate and send a turn to a healthy LAN host instead of only `127.0.0.1`.

Proposed shape:

- A local list of Ollama base URLs (the same idea as `~/.jewbot/hosts.json`, but for models, not SSH). Defaults stay `http://127.0.0.1:11434`. Other entries must be private LAN addresses. Public and paid hosts stay refused unless `JEWBOT_ALLOW_PAID=1`.
- A health check per host before a turn: `GET /api/tags` (and a short timeout). Record reachability, the model names that host has, and the last error.
- Routing: prefer a healthy host that already has the requested model. If the preferred host is down, try the next healthy LAN host. Do not silently fall through to a paid API.
- The UI shows which host answered. A dead host is skipped, not fatal, when another LAN host is healthy.
- No new paid service. No cloud broker.

M7 packaging: `npm run dist` builds the current OS. `dist:mac`, `dist:linux`, and `dist:win` build that OS. Native modules are rebuilt with `electron-builder install-app-deps` (`@electron/rebuild`) for `node-pty` and ssh2's optional `cpu-features`. ssh2's `sshcrypto.node` is not packaged (Electron does not export the OpenSSL symbols it calls); ssh2 uses its JavaScript crypto. Installers are unsigned. A `v*` tag runs `.github/workflows/build.yml`, which uploads artifacts to a **draft** GitHub Release and does not publish it. Raspberry Pi builds are the linux arm64 AppImage and deb. Use a small model there (`qwen2.5-coder:1.5b`).

Cascade still keeps a task queue in the open project's `.jewbot/cascade.json` (gitignored) and writes one receipt per finished task under `.jewbot/receipts/`. A destructive command, a file edit, a secret read, an SSH host-key check, an SSH passphrase, or `ask_owner` marks that task blocked and is not approved by the model.

SSH sessions still connect only to hosts in `~/.jewbot/hosts.json` (or `JEWBOT_SSH_HOSTS`). File writes stay inside the open project and land only after Accept.

Tags `m5` and `m6` already point at the M6 merge on `main` (`bbad481`). Do not move them. After M7 merges to `main`, tag that commit `m7` if you want a milestone tag. Push a `v*` tag (for example `v0.1.0`) only when you want the draft release workflow to run. Do not tag the feature branch, and do not publish the draft from the workflow.
