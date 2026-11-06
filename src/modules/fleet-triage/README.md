# Fleet triage

Stub for the former cloud fleet agent. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. SSH stays on Jewbot’s allowlist (`~/.jewbot/hosts.json`). A future triage note must use `moduleChat`. Host passwords and cloud control-plane tokens stay owner-local. See `docs/migrations/fleet-triage.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
