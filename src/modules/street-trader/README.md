# Street Trader

Stub for the former cloud trading agent. `index.ts` exports a `JewbotModule`. `manifest.ts` registers it.

`health()` pings local Ollama `/api/tags`. This module does not place orders or call a broker. A future note tool must call `moduleChat` only. Broker secrets stay owner-local. See `docs/migrations/street-trader.md`.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. Paid hostnames need `JEWBOT_ALLOW_PAID=1` and are off by default.
