# Jewbot

**Open-source Cursor-like coding agent** that runs on **free/local LLMs** (Ollama) by default — **$0 API spend** unless you explicitly approve otherwise.

Terminal control, SSH to your machines (Dell / Pi / Mac), agentic plan→act→observe loop, file edits with diff preview, project-aware context, and cascade execution across milestones.

> **Status:** Milestone **M1** — live Ollama streaming chat and an agent loop with `read_file` / `list_dir`. Terminal streaming and destructive-command UX are **M2**.

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

That builds the Electron app and opens the chat window. **Agent** mode streams tokens from Ollama, then runs `list_dir` and `read_file` inside the open folder. **Chat** mode is the same stream with no tools.

Try:

```text
List this project and read README.md. Tell me the one-line description.
```

Tokens appear as Ollama generates them. Each tool call shows up as a card with the tool name and the observation (directory listing or file text).

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

`npm test` runs the safety smoke and `npm run test:m1` (Ollama client + jailed `read_file` / `list_dir` + a scripted agent turn). `npm run test:ui` opens the Electron window, checks the preload bridge, streams a fake token/tool turn, and sends one live agent message (it errors cleanly when Ollama is not running).

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama base URL. `127.0.0.1:11434` (no scheme) is accepted. Non-local hosts need `JEWBOT_ALLOW_PAID=1`. |
| `JEWBOT_MODEL` | `qwen2.5-coder:7b` | Chat model name sent to `/api/chat` |
| `JEWBOT_PROJECT_ROOT` | process cwd | Directory the agent may list and read. The UI can change it with **Open project**. |
| `JEWBOT_ALLOW_PAID` | unset/`0` | Must be `1` before any paid or non-local provider host is contacted |

## Safety (always on)

- Paid / cloud LLM calls blocked unless explicitly enabled
- Destructive patterns (`rm -rf`, `git push --force`, …) require confirmation
- File reads and listings are jailed to the opened project root (symlink-resolved) and skip `.gitignore` / secret names (`.env`, keys, `node_modules`, `.git`)
- File writes still require confirmation (`propose_edit` / `applyEdit`)

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
