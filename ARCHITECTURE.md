# Jewbot Architecture (M0)

Open-source Cursor-like coding agent. **Default cost: $0** via local Ollama.
No paid API calls unless the owner explicitly enables and approves a spend path.

## Design principles

1. **Local-first LLM** — Ollama (or compatible OpenAI-style local server) is the only default provider.
2. **Observe before act** — agent loop is plan → act → observe → iterate.
3. **Human gates for danger** — destructive shell/git and any non-zero spend require confirmation.
4. **Cascade** — when a milestone finishes successfully, start the next without waiting for owner input.
5. **Reuse JU patterns** — safety rails inspired by `ju-agent` (approved shell + execution_id) and `ju-command-center` (commander loop, fleet SSH probe, receipts).

## Stack choice: Electron + TypeScript

| Option | Verdict |
|--------|---------|
| **Electron + TypeScript** | **Chosen for M0** |
| Tauri + Rust | Deferred |

**Why Electron (not Tauri) for MVP:**

- Pure JS/TS toolchain via npm — no Rust toolchain required (keeps $0 / free-path setup simple).
- Mature packages for IDE needs: `node-pty` (terminal), `ssh2` (SSH), Node `child_process` streaming.
- Fastest path to a desktop shell with IPC between UI and privileged main process.
- Aligns with TypeScript already used across JU repos (`ju-harness`, `ju-persona-studio`, `ju-builder-ai`).

Tauri remains a future option if we need smaller binaries; architecture keeps modules Node-portable so a Tauri sidecar could host the same agent core later.

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Renderer (UI)                                      │
│  chat · file tree · diff preview · terminal pane · SSH panel │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC (preload bridge)
┌───────────────────────────▼─────────────────────────────────┐
│  Electron Main                                               │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│  │ Agent    │ │ Cascade  │ │ Safety │ │ Context│ │ Files  │ │
│  │ Loop     │ │ Runner   │ │ Rails  │ │ Indexer│ │ / Diff │ │
│  └────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ └───┬────┘ │
│       │            │           │          │          │       │
│  ┌────▼─────┐ ┌────▼─────┐ ┌───▼────┐ ┌──▼───┐ ┌────▼────┐ │
│  │ Ollama   │ │ Terminal │ │ SSH    │ │ ignore│ │ fs+diff │ │
│  │ Provider │ │ (pty)    │ │ Manager│ │ .git  │ │ preview │ │
│  └──────────┘ └──────────┘ └────────┘ └──────┘ └─────────┘ │
└─────────────────────────────────────────────────────────────┘
         │ localhost:11434              │ ssh hosts (Dell/Pi/Mac)
         ▼                              ▼
      Ollama                         Remote shells
```

## Modules

### 1. Desktop shell (`src/main`, `src/renderer`, `src/preload`)

- Main process owns privileged ops (shell, SSH, filesystem writes).
- Preload exposes a narrow typed API to the renderer (no Node in renderer).
- Renderer: minimal HTML/CSS/TS UI for M0; richer editor later.

### 2. Ollama provider (`src/modules/llm`)

- Talks to `http://127.0.0.1:11434` by default (`OLLAMA_HOST` override).
- Endpoints: `/api/tags`, `/api/chat` (streaming).
- **Never** calls paid cloud APIs unless Safety allows a named provider and owner approved spend.
- Model pick is local (e.g. `llama3.2`, `qwen2.5-coder`) — no automatic downloads that cost money (Ollama pulls are free/local bandwidth).

### 3. Agent loop (`src/modules/agent`)

```
goal → PLAN (LLM) → ACT (tool call) → OBSERVE (tool result) → …
                 ↑________________iterate until done / blocked / max steps
```

Tools (M0 stubs → M1+):

- `read_file`, `list_dir`, `search_files` / `search_context`, `find_files`, `get_project_summary` (M4)
- `propose_edit` / `write_file` / `apply_edit` (unified diff; apply only after owner Accept — M3)
- `run_terminal` (via Safety)
- `ssh_exec` (via Safety + session manager)
- `ask_owner` (pause cascade for human gate)

Patterns reused from **ju-agent**: explicit approval flags, execution IDs, bounded timeouts, stdout/stderr truncation, no silent retries of uncertain shell state.

### 4. Terminal (`src/modules/terminal`)

- Local: `node-pty` when available, else `child_process` spawn with streamed stdout/stderr.
- Capture exit code, duration, truncated output.
- Stream chunks to renderer over IPC.

### 5. SSH (`src/modules/ssh`)

- Session manager over `ssh2` (key-based / agent; no passwords stored in repo).
- Connect / run / disconnect; multiple named hosts (Dell, Pi, Mac).
- Patterns reused from **ju-command-center** `ju_fleet_remote_probe.py`: BatchMode, ConnectTimeout, allowlisted hosts, receipt-style results — no arbitrary credential embedding.

### 6. File editing + diff (`src/modules/files`)

- Read/write within project root only (path jail).
- Unified diff via `diff` package before apply.
- Renderer shows the diff; apply waits for Accept (M3). Reject writes nothing. Undo restores the previous bytes.
- Secret paths (`.env`, keys) stay closed unless the owner accepts that open. `node_modules`, `.git`, and other ignored paths do not open.

### 7. Context indexer (`src/modules/context`)

- Walk the project tree respecting `.gitignore` (including nested files) via the `ignore` package, plus default ignores: `node_modules`, `.git`, `dist`, build caches, binaries, and secrets (`.env` except `.env.example`, keys, `*.pem`).
- Jail: the walk is realpath-bound to the project root. Symlinks that point outside are not indexed and their targets are not read.
- APIs: `getProjectSummary`, `findFiles` (substring or glob), `searchContext` (line excerpts). Agent tools: `get_project_summary`, `find_files`, `search_context` (`search_files` alias).
- Each agent turn and each chat turn gets a compact tree plus a few goal-matched excerpts, not the whole repo.

### 8. Cascade runner (`src/modules/cascade`)

- Ordered milestone queue: when status becomes `done`, enqueue/start next automatically.
- On `blocked` / `needs_confirmation`, pause and surface to owner.
- Inspired by **ju-command-center** commander loop + receipt writeback (START / CHANGE / BLOCKED / VERIFIED_COMPLETE).

### 9. Safety rails (`src/modules/safety`)

| Rule | Behavior |
|------|----------|
| Spend | Default `allowPaidApis=false`. Any paid provider call throws unless owner sets approval. |
| Destructive shell | Detect `rm -rf`, `mkfs`, `dd if=`, etc. → require confirmation. |
| Destructive git | Detect `push --force`, `reset --hard`, `clean -fdx` → require confirmation. |
| Path jail | File ops limited to opened project root. |
| Shell approval | Optional `approved` + `executionId` (ju-agent style) for high-risk commands. |

## Milestone roadmap

| ID | Scope |
|----|--------|
| **M0** | Architecture + scaffold + stubs (this commit) |
| **M1** | Ollama chat streaming + agent loop with read/list tools (**done**) |
| **M2** | Terminal streaming + Safety destructive confirmation (**done**) |
| **M3** | File edit + diff preview apply (**done**) |
| **M4** | Context indexer (.gitignore-aware) (**done**) |
| **M5** | SSH sessions + remote exec |
| **M6** | Cascade runner wired to milestones |
| **M7** | Polish UI + packaging |

## Security notes

- Jewbot is **not a sandbox**. Local shell runs with the user's OS permissions.
- Prefer key-based SSH; never commit tokens or host private keys.
- Receipts / logs must redact secrets (token scrubbing pattern from ju-agent `ju_shell.py`).

## Non-goals (M0)

- Cloud LLM billing integration
- Full VS Code extension compatibility
- Multi-user auth
