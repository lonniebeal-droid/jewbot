# Jewbot

**Open-source Cursor-like coding agent** that runs on **free/local LLMs** (Ollama) by default — **$0 API spend** unless you explicitly approve otherwise.

Terminal control, SSH to your machines (Dell / Pi / Mac), agentic plan→act→observe loop, file edits with diff preview, project-aware context, and cascade execution across milestones.

> **Status:** Milestone **M0** — architecture + TypeScript/Electron scaffold. Runtime features are stubs ready for M1+.

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

Typecheck only:

```bash
npm run typecheck
npm run test:safety
```

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama base URL |
| `JEWBOT_MODEL` | `qwen2.5-coder:7b` | Default chat model |
| `JEWBOT_ALLOW_PAID` | unset/`0` | Must be `1` **and** owner approval for any paid provider |

## Safety (always on)

- Paid / cloud LLM calls blocked unless explicitly enabled
- Destructive patterns (`rm -rf`, `git push --force`, …) require confirmation
- File writes jailed to the opened project root

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
