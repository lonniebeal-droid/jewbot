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
| **M8** | **COMPLETE** | Module loader / bot hub: other bots register as modules and run on local Ollama |

M0 completed: 2026-10-23 (America/New_York).
M1 completed: 2026-10-23 (America/New_York).
M2 completed: 2026-10-23 (America/New_York).
M3 completed: 2026-10-23 (America/New_York).
M4 completed: 2026-10-23 (America/New_York).
M5 completed: 2026-11-02 (America/New_York).
M6 completed: 2026-11-02 (America/New_York).
M7 completed: 2026-11-06 (America/New_York).

**M7** packages unsigned installers. `npm run dist` builds the current OS. `dist:mac`, `dist:linux`, and `dist:win` build that OS. Native modules are rebuilt with `electron-builder install-app-deps` (`@electron/rebuild`) for `node-pty` and ssh2's optional `cpu-features`. ssh2's `sshcrypto.node` is not packaged (Electron does not export the OpenSSL symbols it calls); ssh2 uses its JavaScript crypto. A `v*` tag runs `.github/workflows/build.yml`, which uploads artifacts to a **draft** GitHub Release and does not publish it. Raspberry Pi builds are the linux arm64 AppImage and deb. Use a small model there (`qwen2.5-coder:1.5b`). Signing and notarization stay off.

**M8** is the module loader on main. Jewbot is the hub. Built-in modules, the real Muse finisher, and the migration stubs register at boot and show in the Modules panel. A module that chats goes through `src/modules/llm/ollama.ts` and `assertLocalSpendOnly`. Paid hostnames, including Grok and xAI, stay refused unless `JEWBOT_ALLOW_PAID=1`. Muse still refuses every non-local host even when that flag is set. Migration order is in `docs/receipts/2026-11-06-m8-module-loader.md`. The API is `docs/MODULE_API.md`.

## On main for v0.1.0

These landed after the M7 packaging commit (`8af079e`, pull request #10). Installers stay unsigned. None of them spend money.

**Music release (#14).** Local weekly album checklist in the open project's `.jewbot/music-release.json`. Agent tools are `music_list_releases`, `music_next_free`, and `music_mark`. DistroKid, store login, and payment stay human gates. Marking a release done waits for the owner. Optional notes use local Ollama only.

**Echo (#15).** Local worker. Ollama is `http://127.0.0.1:11434` and the model is `tinyllama`. `health()` pings `GET /api/tags`. `echo_task` calls `chatOnce` after `assertLocalSpendOnly`. Credential and keystroke requests are refused and do not fetch.

**TwinRent (#16).** Local listing checklist in `.jewbot/twinrent-plan.json` (step ids and statuses only). The publish step stays blocked. `twinrent_draft` uses local Ollama after `assertLocalSpendOnly`. It does not log into a rental site, and it refuses credentials, keystrokes, and tenant contacts.

**LAN multi-host Ollama routing (#17).** Registry in `JEWBOT_OLLAMA_HOSTS` or `~/.jewbot/ollama-hosts.json` (project `.jewbot/ollama-hosts.json` when the home file is absent). Fallback order is the list order, for example mac, dell, pi, then `127.0.0.1:11434`. Every host passes `assertLocalSpendOnly` before `GET /api/tags`. Only loopback, private LAN (`10/8`, `172.16/12`, `192.168/16`), Tailscale `100.64.0.0/10`, and IPv6 unique-local addresses are contacted. Public and paid hosts are refused and are not fetched. Hub `health()` lists each host and selects the first healthy host that has the requested model. No new SSH actions.

Cascade keeps a task queue in the open project's `.jewbot/cascade.json` (gitignored) and writes one receipt per finished task under `.jewbot/receipts/`. Start runs the next pending task through the local Ollama agent. When that task finishes cleanly, and its acceptance command exits 0 if one was set, the next pending task starts without waiting. A destructive command, a file edit, a secret read, an SSH host-key check, an SSH passphrase, or `ask_owner` marks that task blocked and is not approved by the model. The runner then continues with the next pending task. Stop aborts the current task. Pause finishes it and then waits. Paid providers stay off unless `JEWBOT_ALLOW_PAID=1`.

SSH sessions still connect only to hosts in `~/.jewbot/hosts.json` (or `JEWBOT_SSH_HOSTS`). The first connection shows the host-key fingerprint and stores it only after the owner confirms. File writes stay inside the open project, show a unified diff, and land only after Accept. Destructive shell commands stay soft-blocked until the owner confirms. Cascade does not click those confirms for you.

Tags `m5` and `m6` stay on `bbad481`. Do not move them. The lightweight tag `m7` points at the M7 packaging commit `8af079e` (pull request #10). Do not put `m7` on a later module commit. A `v0.1.0` tag is what starts `.github/workflows/build.yml` and uploads installers to a **draft** GitHub Release. That tag is not pushed from the docs change. Do not publish the draft from the workflow.
