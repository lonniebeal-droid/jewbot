# Twinrent

Stub for the former cloud rental agent. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. It does not publish a listing. A future draft must call `moduleChat`. Platform tokens and tenant data stay owner-local. See `docs/migrations/twinrent.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
