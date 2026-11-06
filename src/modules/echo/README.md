# Echo

Stub for the former general cloud worker. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. There is no hosted agent endpoint. A future task must call `moduleChat` (`src/modules/llm/ollama.ts` and `assertLocalSpendOnly`). The old worker key stays owner-local. See `docs/migrations/echo.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
