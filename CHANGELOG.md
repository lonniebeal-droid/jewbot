# Changelog

All notable changes to Jewbot are listed here. The packaged app version comes from `package.json`.

## 0.1.0 — 2026-11-06

First installable build. Milestones M0 through M7 are in this version. Installers are unsigned. Code signing and Apple notarization are off because they cost money. That stays an owner decision.

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
