# JU repo survey (2026-10-23)

Surveyed `lonniebeal-droid` via cursor-github (`list_my_repositories` + `search_repositories`).
Account type: **User** (not a GitHub Organization). 26 accessible repos.

## Not found as named repos

- `JU AI Studio` / `ju-ai-studio`
- `JU Security Lab` / `ju-security-lab`
- `jewbot` / `jewbot-ide` (name free)

Closest related: `ju-persona-studio` (“Persona Studio / JU Character”), `ju-agent`, `ju-command-center`.

## High-value reuse targets

### ju-agent (private, TypeScript/Python mix)
- Local Ollama agent on Dell (`:8771`)
- `ju_shell.py`: owner-authorized shell, `approved` + `execution_id`, sqlite ledger, output truncation, secret redaction
- Worker allowlist (`ollama.ask`, `file.read`, …) — $0 / local-only
- **Jewbot mapping:** `src/modules/safety`, `src/modules/terminal`, `src/modules/llm`

### ju-command-center (private, Python)
- Cascade / commander loop, receipts, dispatch architecture
- `ju_fleet_remote_probe.py`: read-only SSH probe, allowlisted hosts, BatchMode, ConnectTimeout
- **Jewbot mapping:** `src/modules/cascade`, `src/modules/ssh`

### ju-harness (private, TypeScript + Capacitor/Vite)
- TS packaging patterns; mobile-oriented — not chosen for desktop IDE shell
- **Jewbot mapping:** TS conventions only; desktop = Electron for M0

### Other JU-* noted
`ju-builder-ai`, `ju-persona-studio`, `ju-universal-troubleshooter`, `ju-ai-hospital`, `ju-social-command-center`, …

## Stack decision
Electron + TypeScript over Tauri for M0 (npm-only free toolchain; `node-pty` / `ssh2` maturity).
