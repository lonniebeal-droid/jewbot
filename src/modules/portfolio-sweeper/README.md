# Portfolio sweeper

Stub for the former cloud portfolio agent. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. It does not call a brokerage or move funds. A future summary must call `moduleChat` on local files. Account keys stay owner-local. See `docs/migrations/portfolio-sweeper.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
