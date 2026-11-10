# Jewbot

**Open-source Cursor-like coding agent** that runs on **free/local LLMs** (Ollama) by default — **$0 API spend** unless you explicitly approve otherwise.

Terminal control, SSH to your machines (Dell / Pi / Mac), agentic plan→act→observe loop, file edits with diff preview, project-aware context, and cascade execution across milestones.

> **Status:** Milestone **M7** (this branch) — unsigned installers for macOS (Apple silicon and Intel), Linux AppImage and deb (x64 for a Dell, arm64 for a Raspberry Pi), and Windows NSIS (x64). Code signing and notarization are **off** (they cost money; that is an owner decision). Milestone **M8** (module hub) is already on main: other bots register under Jewbot and use local Ollama. Cascade (M6) and the Muse finisher stay as they are.

## Why Jewbot?

- Cursor-class agent loop without a subscription
- Local models via [Ollama](https://ollama.com)
- Built-in terminal + SSH
- Safety rails: no paid APIs and no destructive ops without confirmation

## Stack

- **TypeScript + Electron** (chosen for M0 — free npm toolchain, mature `node-pty` / `ssh2`)
- See [ARCHITECTURE.md](./ARCHITECTURE.md) for module design and Tauri notes

## Prerequisites

1. **Node.js 20+**
2. **Ollama** installed and running locally:
   ```bash
   # https://ollama.com — install, then:
   ollama pull qwen2.5-coder:7b   # or any local model you prefer
   ollama serve                   # default http://127.0.0.1:11434
   ```
3. (Optional) SSH keys for remote hosts — never commit private keys

## Install

Packaged builds are **unsigned**. Jewbot does not buy a certificate, and it does not notarize. Gatekeeper (macOS) and SmartScreen (Windows) will warn until you choose to open the app. Turning signing on later is an owner decision because it costs money. The GitHub Actions workflow never publishes a release: a `v*` tag only uploads installers to a **draft**.

Ollama is not inside the installer. Install it on the same machine (or use a host you already run) and leave `JEWBOT_ALLOW_PAID` unset.

Build them yourself from this repo (`npm install` first). `npm run dist` packages the OS you are on, for that machine's CPU only, so `node-pty` and ssh2's optional `cpu-features` rebuild with `@electron/rebuild` via `electron-builder install-app-deps`. Pass `--x64` or `--arm64` after `--` when you are on a matching machine.

ssh2 also has an optional native cipher addon (`sshcrypto.node`). It is **not** included in the package. Electron's BoringSSL does not export the OpenSSL symbols that addon calls (`ERR_set_mark`), so a Node build fails to load and a system-OpenSSL build aborts the process. ssh2 catches the missing addon and uses its JavaScript crypto instead. SSH still works.

```bash
npm run dist          # this OS, this CPU
npm run dist:mac      # dmg + zip
npm run dist:linux    # AppImage + deb
npm run dist:win      # NSIS
npm run rebuild:native
```

### macOS (Apple silicon and Intel)

Artifacts: `Jewbot-0.1.0-mac-arm64.dmg` and `Jewbot-0.1.0-mac-arm64.zip`, plus the same names with `x64`.

1. Open the dmg and drag Jewbot to Applications, or unzip the zip.
2. First launch: right-click the app, choose **Open**, then **Open** again. Or, after copying it out of the dmg:

```bash
xattr -dr com.apple.quarantine /Applications/Jewbot.app
```

Notarization is off, so macOS will not have a notarization ticket.

### Windows (x64, including a Dell)

Artifact: `Jewbot-0.1.0-win-x64.exe` (NSIS). Run the installer. If SmartScreen says it protected your PC, choose **More info**, then **Run anyway**. The installer is per-user and lets you pick a folder. There is no Authenticode signature.

### Linux (x64, including a Dell)

electron-builder names these with the distro arch, not `x64`:

- `Jewbot-0.1.0-linux-x86_64.AppImage`
- `Jewbot-0.1.0-linux-amd64.deb`

```bash
chmod +x Jewbot-0.1.0-linux-x86_64.AppImage
./Jewbot-0.1.0-linux-x86_64.AppImage
```

If the AppImage cannot mount itself, install FUSE (`sudo apt install libfuse2`) or run `./Jewbot-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run`.

Debian or Ubuntu:

```bash
sudo apt install ./Jewbot-0.1.0-linux-amd64.deb
jewbot
```

### Raspberry Pi (64-bit, linux arm64)

Use a 64-bit Raspberry Pi OS. The 32-bit image is not a build target. Artifacts: `Jewbot-0.1.0-linux-arm64.AppImage` and `Jewbot-0.1.0-linux-arm64.deb` (same install steps as Linux above). On the Pi itself, `npm run dist:linux` builds the arm64 packages.

Install Ollama, then pull a **small** model. A 7B model is a poor fit for a Pi:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5-coder:1.5b
```

Start Jewbot pointed at that model:

```bash
JEWBOT_MODEL=qwen2.5-coder:1.5b jewbot
```

`OLLAMA_HOST` still defaults to `http://127.0.0.1:11434`. A non-local host is refused unless you set `JEWBOT_ALLOW_PAID=1`.

### Version

The window title, the header badge, and **About** read the version from `package.json` (currently **0.1.0**, milestone M7). A packaged build prints the same line and exits:

```bash
jewbot --jewbot-version
```

## Quick start

```bash
git clone https://github.com/lonniebeal-droid/jewbot.git
cd jewbot
npm install
npm start
```

That builds the Electron app and opens the chat window. **Agent** mode streams tokens from Ollama, then runs `get_project_summary`, `find_files`, `search_context`, `list_dir`, `read_file`, `write_file`, `apply_edit`, `run_terminal`, and the SSH tools inside the open folder. **Chat** mode is the same stream with no tools. Both modes get a compact project snapshot, not a dump of every file.

Try:

```text
List this project and read README.md. Tell me the one-line description.
```

Tokens appear as Ollama generates them. Each tool call shows up as a card with the tool name and the observation (directory listing, file text, or terminal output).

### Run a streamed command

The **Terminal** panel on the right runs a shell in the open project folder. Type a command and press **Run** (or Enter). Stdout and stderr show up as the process writes them. **Kill** stops that session.

```text
echo jewbot
```

You can also ask the agent, which calls `run_terminal` and streams the same output into the tool card and into the next observation:

```text
Run echo jewbot in the terminal and tell me what it printed.
```

`JEWBOT_TERMINAL_BACKEND=child_process` is the default (separate stdout and stderr). If the optional `node-pty` module is installed, `JEWBOT_TERMINAL_BACKEND=pty` uses a PTY instead; a PTY merges both streams into stdout.

### SSH to another machine

Jewbot talks to machines you list locally. It does not discover hosts, and it does not read passwords from the hosts file. Create `~/.jewbot/hosts.json` (mode `0600` is a good idea) or point `JEWBOT_SSH_HOSTS` at another JSON file:

```json
{
  "hosts": [
    {
      "name": "dell",
      "host": "192.168.1.20",
      "port": 22,
      "username": "lonnie",
      "privateKeyPath": "~/.ssh/id_ed25519"
    },
    {
      "name": "pi",
      "host": "192.168.1.21",
      "username": "pi",
      "privateKeyPath": "~/.ssh/id_ed25519",
      "askPassphrase": true
    },
    {
      "name": "mac",
      "host": "mac.local",
      "username": "lonnie",
      "agent": true
    }
  ]
}
```

`privateKeyPath` is a path to a key file, never the key text. `agent: true` uses `SSH_AUTH_SOCK`. `askPassphrase: true` (or an encrypted key) and `askPassword: true` open a prompt. The value stays in memory until that host disconnects and is never written to disk. A field named `password`, `passphrase`, or `privateKey` in the file is rejected.

The **SSH** panel lists those hosts. **Connect** opens one session. The first time Jewbot sees a host key it shows the `SHA256:` fingerprint and does not continue until you choose **Trust this key**. That fingerprint is stored in `~/.jewbot/known_hosts.json` (`JEWBOT_SSH_KNOWN_HOSTS` overrides the path). A later fingerprint that does not match asks again and does not replace the stored key unless you confirm the change.

Type a remote command and press **Run**. Stdout and stderr stream into the panel. **Kill** cancels that command. **Disconnect** closes the session. The same destructive patterns as the local terminal (`rm -rf`, `git push --force`, and the rest) open the confirm dialog before anything is sent.

You can also ask the agent:

```text
List SSH hosts, connect to pi, and run uname -a.
```

The tools are `ssh_list_hosts`, `ssh_connect`, `ssh_exec`, and `ssh_disconnect`. `ssh_exec` uses the same one-shot confirmation grant as `run_terminal`. The model cannot approve itself, and it cannot connect to a host that is not in the file.

### Edit a file

Ask the agent to change a file. It calls `write_file` (full contents) or `apply_edit` (one unique search/replace). Jewbot shows a unified diff and does **not** write until you press **Accept**. **Reject** (or Escape) leaves the file untouched. **Undo** puts the previous bytes back.

```text
Add a "Local-first." line under the title in README.md.
```

Paths stay inside the open project. `.env` and private keys are refused unless you accept that specific edit (or open the file when the agent tries to read it). `node_modules`, `.git`, and other ignored paths stay closed. A model flag such as `confirmed: true` does not skip Accept.

### Project context

Before each agent turn and each chat turn, Jewbot indexes the open folder. The model receives a short tree and, when your question names a file or a symbol, a few matching excerpts. It does not receive the whole repository.

The agent can also call:

- `get_project_summary` — counts plus the compact tree
- `find_files` — path substring or glob (`*.ts`, `src/**/*.ts`)
- `search_context` — case-insensitive text search with line numbers (`search_files` is the same tool)

Skipped by default: anything matched by `.gitignore` (including nested files), `node_modules`, `.git`, `dist`, other build caches, binary files, and secrets (`.env` except `.env.example`, private keys, `*.pem`, credential files). A symlink that points outside the project is not indexed, and its target is not read.

```text
Where is ContextIndexer defined? Show the file and the line.
```

### Cascade a queue of tasks

The **Cascade** panel runs a list of tasks, one after another, on the local model. The queue is stored in the open project at `.jewbot/cascade.json`. That directory is gitignored. Each finished task also gets a markdown receipt at `.jewbot/receipts/<id>.md` (what the agent ran, a short output summary, and the result).

Add a title and a prompt. An acceptance command is optional. **Start** picks the next `pending` task, runs the prompt through the same agent loop as chat, then runs the acceptance command in the project terminal if you set one. Exit 0 marks the task done and the next pending task starts immediately. You do not have to press Start again.

**Pause** lets the current task finish and then waits. **Stop** (in the panel, or the chat Stop button) aborts the current task, marks it blocked with "Stopped by owner", and does not start another. **Requeue** puts a blocked or failed task back to pending. That does not approve anything.

Cascade will not approve a dangerous step for you. If the model asks to run a destructive command, write a file, read a secret, confirm an SSH host key, or type an SSH passphrase, that task is marked **blocked** with the reason and the runner moves on. Do the step yourself from the chat, terminal, or SSH panel if you want it done. A failed acceptance check, a model error, too many steps, or the time budget marks the task **failed** and the runner also moves on.

A task left `running` because the app quit is put back to `pending` the next time the queue is loaded.

Limits, overridable from the environment: 8 steps per task and 3 minutes of wall time. Paid or non-local model hosts stay refused unless `JEWBOT_ALLOW_PAID=1`.

```text
Title: Readme check
Prompt: Read README.md and reply with FINAL and the one-line description.
Acceptance: node -e "process.exit(0)"
```

### Muse finisher

Muse keeps five release blockers (private authenticated model URL, live Gmail and Calendar OAuth, an authenticated end-to-end chat test, Supabase RLS isolation, and the 2026-10-16 production gate) and can ask the local model to restate them. **Muse runs on fleet Ollama only.** The default host is `http://127.0.0.1:11434`. `OLLAMA_HOST` is used only when that host is still local, and `JEWBOT_MODEL` picks the local model. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`. Muse does not store Gmail or Calendar OAuth tokens. The hub registers this module as `muse`. It is not a stub.

### Music release checklist

The music module is a local checklist for the JU Music weekly album pipeline. The queue is `.jewbot/music-release.json` in the open project (gitignored). Copy [docs/examples/music-release.example.json](docs/examples/music-release.example.json) to start a week. The agent tools are `music_list_releases`, `music_next_free`, and `music_mark`. A host argument on those calls is ignored. Free steps are the track list and release notes. Empty notes can be drafted on local Ollama. DistroKid, Spotify login, and payment are marked `blocked` and are not automated. See [docs/migrations/music-release.md](docs/migrations/music-release.md).

### Modules

The **Modules** panel lists every registered module and whether its health check is `ok` or `down`. Built-ins (Ollama, agent, terminal, SSH, files, cascade, safety, context, Muse) and the music release checklist load at startup. Migration stubs for the other bots live under `src/modules/` and only ping local Ollama. See [docs/MODULE_API.md](docs/MODULE_API.md). Chat from a hub module uses `OLLAMA_HOST` and `JEWBOT_MODEL` and refuses paid hostnames, including Grok and xAI, unless `JEWBOT_ALLOW_PAID=1`. Music-release drafts refuse a non-local host even when that flag is set.

### Destructive commands

Jewbot does not run destructive commands by itself. Patterns such as `rm -rf`, `git push --force` / `git push -f`, `mkfs`, `dd of=` / `dd if=`, `chmod -R 777 /`, `git reset --hard`, and `git clean -fd` open a confirm dialog with the exact command.

- **Cancel** (Escape, or the default button) does not run it.
- **Run anyway** mints a one-time execution id for that exact string and only then starts the process.
- The model cannot approve itself by putting `approved` or an `executionId` in the tool call. Ignoring the dialog is a denial.

Try `echo hello` for a normal stream. Try `rm -rf /tmp/example` only if you mean to confirm or cancel it — cancel leaves it unrun.

Open another folder with **Open project**, or start Jewbot already pointed at one:

```bash
JEWBOT_PROJECT_ROOT="$PWD" JEWBOT_MODEL=qwen2.5-coder:7b npm start
```

`OLLAMA_HOST` defaults to `http://127.0.0.1:11434`. A non-local host (including paid APIs such as `api.openai.com`) is refused unless you set `JEWBOT_ALLOW_PAID=1` after you actually mean to spend money. Leave that unset.

Typecheck and smokes (no Ollama required — the M1 smoke mocks `fetch`):

```bash
npm run typecheck
npm test
```

`npm test` runs the safety smoke, `npm run test:m1` (Ollama client + jailed `read_file` / `list_dir` + a scripted agent turn), `npm run test:m2` (destructive classification, a streamed `echo`, session kill, and `run_terminal` through the confirm gate), `npm run test:m3` (diff preview, Accept/Reject, undo, secret-path refusal, and jailed writes on a temp directory), `npm run test:m4` (gitignore-aware index, secret and symlink jail, `find_files` / `search_context`, and a scripted project-aware agent turn), `npm run test:m5` (mocked `ssh2`: allowlist refusal, TOFU, streamed exec, passphrase redaction, and `ssh_exec` through the same confirm gate), `npm run test:m6` (mocked Ollama: cascade auto-advance, blocked-then-skip, acceptance pass/fail, stop, pause, wall time, the step cap, and the paid-host refusal), `npm run test:muse` (five open release blockers, local fleet health and chat with mocked `fetch`, and a refused non-local host with zero fetches), `npm run test:m8` (module register/list/get, discovery, paid-host refusal including xAI, and stub plus Muse health with mocked Ollama), `npm run test:fleet` (local and allowlisted SSH Ollama tags, no paid API), and `npm run test:music` (local weekly checklist, mocked Ollama notes, DistroKid, Spotify, and payment gates with zero distributor fetches, and the same three tools through the agent). `npm run test:ui` opens the Electron window, checks the preload bridge, streams a fake token/tool turn, rejects one diff and accepts then undoes another, runs `echo` in the terminal panel, cancels a destructive confirm, connects a mocked SSH host (passphrase plus host-key trust) and cancels a remote destructive command, stops a cascade task and then auto-advances past a blocked one, lists registered modules with ok or down health, and sends one live agent message (it errors cleanly when Ollama is not running).

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL. `127.0.0.1:11434` (no scheme) is accepted. Non-local hosts need `JEWBOT_ALLOW_PAID=1`. |
| `JEWBOT_MODEL` | `qwen2.5-coder:7b` | Chat model name sent to `/api/chat` |
| `JEWBOT_PROJECT_ROOT` | process cwd | Directory the agent may list and read. The UI can change it with **Open project**. |
| `JEWBOT_ALLOW_PAID` | unset/`0` | Must be `1` before any paid or non-local provider host is contacted |
| `JEWBOT_TERMINAL_BACKEND` | `child_process` | `child_process` keeps stdout and stderr separate. `pty` uses `node-pty` when that optional module loads |
| `JEWBOT_SSH_HOSTS` | `~/.jewbot/hosts.json` | Allowlist of SSH hosts. Passwords and key material do not belong in this file |
| `JEWBOT_SSH_KNOWN_HOSTS` | `~/.jewbot/known_hosts.json` | Fingerprints the owner has confirmed. Jewbot writes this after Trust this key |
| `JEWBOT_CASCADE_MAX_STEPS` | `8` | Most agent steps one cascade task may take |
| `JEWBOT_CASCADE_MAX_MS` | `180000` | Wall-time budget for one cascade task, including its acceptance command |

## Safety (always on)

- Paid / cloud LLM calls blocked unless explicitly enabled
- Destructive patterns (`rm -rf`, `git push --force`, …) require confirmation
- File reads and listings are jailed to the opened project root (symlink-resolved) and skip `.gitignore` / secret names (`.env`, keys, `node_modules`, `.git`)
- The context index uses that same jail. It does not read outside the project, and it does not put secret or binary files into the prompt
- File writes (`write_file`, `apply_edit`, `propose_edit`) stay in that jail, show a unified diff, and apply only after Accept. Secret paths need that confirm; ignored directories do not open
- SSH reaches only hosts listed in the local hosts file. The first connection, and any host-key change, waits for you to confirm the fingerprint. Remote destructive commands use the same confirmation grant as the local terminal
- Cascade runs only the local model, stops at a step that needs you, and will not approve that step itself. The queue and receipts stay in the project's `.jewbot/` directory
- Muse runs on fleet Ollama only. It does not close release blockers on its own and it does not keep Gmail or Calendar OAuth tokens

## Reused from JU repos

| Source | What we reused (patterns, not copy-paste) |
|--------|-------------------------------------------|
| `lonniebeal-droid/ju-agent` | Ollama-local agent, approved shell + execution_id, output truncation, secret redaction |
| `lonniebeal-droid/ju-command-center` | Cascade/commander loop, fleet SSH probe (BatchMode, allowlisted hosts, receipts) |
| `lonniebeal-droid/ju-harness` | TypeScript + Vite packaging familiarity (desktop path is Electron for M0) |

No public repos named “JU AI Studio” / “JU Security Lab” were found under this account; closest related projects are `ju-persona-studio`, `ju-agent`, and `ju-command-center`.

## License

MIT — see [LICENSE](./LICENSE)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
