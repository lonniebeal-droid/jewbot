# Changelog

All notable changes to Jewbot are listed here. The packaged app version comes from `package.json`.

## 0.3.0 (unreleased)

### M15 — Remote SSH workspace

- Open a folder on a host from `~/.jewbot/hosts.json` over SFTP.
- The file tree, editor save, and text search stay inside that remote root.
- A remote terminal command is `cd` into the folder, then the command. Host-key confirm and the destructive grant still apply. Unknown hosts are refused.

### M16 — Agent loop v2

- Plan, act, and observe with a step budget (`maxSteps` or `JEWBOT_AGENT_MAX_STEPS`, default 12).
- Invalid JSON tool calls from a small local model are retried before the step is spent.
- Fix tests runs the command through the terminal first. Destructive commands stay behind the confirm grant.
- Stop still aborts the running request.

### Window wiring

- Ctrl/Cmd+K in the editor asks local Ollama for an inline edit and shows Accept / Reject.
- The chat box expands `@file`, `@folder`, and `@codebase` with `expandMentions` before send.
- The window has a composer panel: add the editor buffer, accept or reject each file or hunk, apply, and undo the batch.
- A git sidebar runs status, diff, stage, unstage, commit, and branch switch. Push, reset, and clean ask first and use the confirm grant. Commit does not push.
- `npm run build` copies Monaco `vs/` into `dist/renderer` and fails if that package is missing, so dev and packaged builds mount the editor.

## 0.2.0 — 2026-11-21

Cursor-parity editor work on local Ollama only. Installers stay unsigned. This changelog does not push a git tag.

### M9 — Editor

- Monaco pane (`#monacoEditor`) with file tabs and a project tree.
- Dirty tabs show a `•` marker.
- Ctrl/Cmd+S writes human typing immediately inside the project jail.
- Agent text stays on the M3 diff until the owner presses Accept.

### M10 — Tab autocomplete

- Inline ghost text from Ollama fill-in-the-middle (`POST /api/generate` with `suffix`).
- Default model `qwen2.5-coder:1.5b` (`JEWBOT_COMPLETE_MODEL` overrides it).
- Debounced and cancellable. Tab accepts, Esc dismisses.
- Disabled when the host registry has no healthy local Ollama. Every generate call passes `assertLocalSpendOnly`.

### M11 — Semantic codebase index

- Local embeddings via Ollama `POST /api/embed` with `nomic-embed-text`, stored in `.jewbot/index/vectors.json`.
- Re-index skips unchanged files and paths ignored the same way as M4 (`.gitignore`, `node_modules`, `dist`, `.git`, secrets).
- Agent tool `semantic_search`. Chat mentions `@file`, `@folder`, and `@codebase` expand locally.

### M12 — Composer

- Multi-file agent edits land in one review batch.
- Accept or reject a whole file or one hunk.
- Apply writes only the accepted text. One undo restores every file in that apply.

### M13 — Git panel

- Status, staged and unstaged diffs, stage, unstage, commit, and branch switch stay local.
- A commit message can be drafted on local Ollama after `assertLocalSpendOnly`.
- Push, force-push, reset, and clean wait for the existing confirm grant. Commit never pushes.

### M14 — Inline edit

- A selection plus a prompt goes to local Ollama after `assertLocalSpendOnly`.
- The model reply replaces only that selection and is shown as a unified diff.
- Accept writes it. Reject leaves the file alone.

## 0.1.0 — 2026-11-10

First installable build. Milestones M0 through M7, plus the local modules and LAN routing below. Installers are unsigned. Code signing and Apple notarization are off because they cost money. That stays an owner decision. Spend stays $0.

### LAN multi-host Ollama routing (#17)

- Host registry in `JEWBOT_OLLAMA_HOSTS` or `~/.jewbot/ollama-hosts.json`. List order is the fallback order (mac, dell, pi, then `127.0.0.1:11434`).
- Each host passes `assertLocalSpendOnly` before `GET /api/tags`. Only loopback, private LAN, Tailscale `100.64.0.0/10`, and IPv6 unique-local addresses are contacted.
- Hub `health()` lists every host and selects the first healthy host that has the requested model. Public and paid hosts are not fetched. No new SSH actions.

### TwinRent (#16)

- Local listing checklist in `.jewbot/twinrent-plan.json`. The file stores step ids and statuses. The publish step stays blocked.
- `twinrent_draft` uses local Ollama after `assertLocalSpendOnly`. Credentials, keystrokes, and tenant contacts are refused. Nothing is posted to a rental site.

### Echo (#15)

- Local worker on Ollama at `http://127.0.0.1:11434`, model `tinyllama`.
- `health()` pings `GET /api/tags`. `echo_task` calls `chatOnce` after `assertLocalSpendOnly`.
- Credential and keystroke requests do not fetch. There is no cloud agent.

### Music release (#14)

- Local weekly album checklist in `.jewbot/music-release.json`.
- Agent tools: `music_list_releases`, `music_next_free`, `music_mark`. Marking a release done waits for the owner.
- DistroKid, store login, and payment stay human gates. Optional notes use local Ollama only.

### M7 — Packaging

- electron-builder config for macOS dmg and zip (arm64 and x64), Linux AppImage and deb (x64 and arm64), and Windows NSIS (x64).
- `npm run dist`, `dist:linux`, `dist:mac`, and `dist:win`. `node-pty` and ssh2's optional `cpu-features` are rebuilt with `electron-builder install-app-deps` (`@electron/rebuild`). ssh2's optional `sshcrypto.node` is left out: Electron does not export the OpenSSL symbols it needs, and ssh2 uses its JavaScript crypto instead.
- Header version badge and an About dialog read `package.json` (`0.1.0`). `--jewbot-version` prints the same version and exits.
- GitHub Actions (`.github/workflows/build.yml`): pull requests run typecheck and `npm test`. A `v*` tag builds the installers and uploads them to a draft GitHub Release. The workflow does not publish the release and does not need repository secrets.
- Raspberry Pi (64-bit) uses the arm64 packages and a small Ollama model (`qwen2.5-coder:1.5b`).

### M6 — Cascade

- A task queue in the open project's `.jewbot/cascade.json` runs one local-model task, then starts the next.
- A step that needs a person (destructive command, file Accept, secret read, SSH host key, passphrase) is marked blocked and skipped. The model cannot approve it.
- Optional acceptance command. Stop and Pause. One markdown receipt per finished task.

### M5 — SSH

- Sessions via `ssh2` to hosts listed in `~/.jewbot/hosts.json`.
- First connection shows the host-key fingerprint and stores it only after you confirm.
- Streamed remote exec. Destructive remote commands use the same confirmation grant as the local terminal.
- Passphrases stay in memory for the session and are not written to the hosts file.

### M4 — Project context

- Gitignore-aware index of the open folder: compact tree, `find_files`, `search_context`.
- Skips secrets, binaries, `node_modules`, `.git`, and symlinks that point outside the project.
- The model receives a short snapshot, not the whole repo. Embeddings are not required.

### M3 — File edits

- `write_file` and `apply_edit` show a unified diff.
- Nothing is written until Accept. Reject leaves the file alone. Undo restores the previous bytes.
- Secret paths need that confirm. Ignored directories stay closed.

### M2 — Terminal

- The terminal panel streams stdout and stderr for a command in the open project.
- Destructive patterns (`rm -rf`, `git push --force`, and the rest) open a confirm dialog. Cancel does not run the command.
- A model flag such as `approved: true` does not skip the dialog.

### M1 — Ollama chat

- Streaming chat and agent modes against local Ollama (`http://127.0.0.1:11434` by default).
- Agent tools `read_file` and `list_dir`, jailed to the open project.
- A non-local or paid host is refused unless `JEWBOT_ALLOW_PAID=1`.

### M0 — Scaffold

- Electron and TypeScript app, module layout, and the safety smoke.
- Default spend gate is local-only.
