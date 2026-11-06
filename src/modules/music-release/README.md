# Music Release Engine

Stub for the former cloud release agent. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. It does not upload a release. A future draft tool must call `moduleChat` (`src/modules/llm/ollama.ts` and `assertLocalSpendOnly`). Distributor tokens stay owner-local. See `docs/migrations/music-release.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
