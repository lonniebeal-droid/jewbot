# Jewbot

**Open-source Cursor-like coding agent** that runs on **free/local LLMs** (Ollama) by default — **$0 API spend** unless you explicitly approve otherwise.

Terminal control, SSH to your machines (Dell / Pi / Mac), agentic plan→act→observe loop, file edits with diff preview, project-aware context, and cascade execution across milestones.

> **Status:** Milestone **M4** — project-aware context. The agent sees a compact tree and a few relevant excerpts, and can `find_files` / `search_context` without loading the whole repo. **M5** (SSH sessions) is next.

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

## Quick start

```bash
git clone https://github.com/lonniebeal-droid/jewbot.git
cd jewbot
npm install
npm start
```

That builds the Electron app and opens the chat window. **Agent** mode streams tokens from Ollama, then runs `get_project_summary`, `find_files`, `search_context`, `list_dir`, `read_file`, `write_file`, `apply_edit`, and `run_terminal` inside the open folder. **Chat** mode is the same stream with no tools. Both modes get a compact project snapshot, not a dump of every file.

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

`npm test` runs the safety smoke, `npm run test:m1` (Ollama client + jailed `read_file` / `list_dir` + a scripted agent turn), `npm run test:m2` (destructive classification, a streamed `echo`, session kill, and `run_terminal` through the confirm gate), `npm run test:m3` (diff preview, Accept/Reject, undo, secret-path refusal, and jailed writes on a temp directory), and `npm run test:m4` (gitignore-aware index, secret and symlink jail, `find_files` / `search_context`, and a scripted project-aware agent turn). `npm run test:ui` opens the Electron window, checks the preload bridge, streams a fake token/tool turn, rejects one diff and accepts then undoes another, runs `echo` in the terminal panel, cancels a destructive confirm, and sends one live agent message (it errors cleanly when Ollama is not running).

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL. `127.0.0.1:11434` (no scheme) is accepted. Non-local hosts need `JEWBOT_ALLOW_PAID=1`. |
| `JEWBOT_MODEL` | `qwen2.5-coder:7b` | Chat model name sent to `/api/chat` |
| `JEWBOT_PROJECT_ROOT` | process cwd | Directory the agent may list and read. The UI can change it with **Open project**. |
| `JEWBOT_ALLOW_PAID` | unset/`0` | Must be `1` before any paid or non-local provider host is contacted |
| `JEWBOT_TERMINAL_BACKEND` | `child_process` | `child_process` keeps stdout and stderr separate. `pty` uses `node-pty` when that optional module loads |

## Safety (always on)

- Paid / cloud LLM calls blocked unless explicitly enabled
- Destructive patterns (`rm -rf`, `git push --force`, …) require confirmation
- File reads and listings are jailed to the opened project root (symlink-resolved) and skip `.gitignore` / secret names (`.env`, keys, `node_modules`, `.git`)
- The context index uses that same jail. It does not read outside the project, and it does not put secret or binary files into the prompt
- File writes (`write_file`, `apply_edit`, `propose_edit`) stay in that jail, show a unified diff, and apply only after Accept. Secret paths need that confirm; ignored directories do not open

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
