# Echo

Local general worker. `index.ts` exports `jewbotModule`. `manifest.ts` registers it. Version 0.2.0 replaces the M8 stub.

Echo's Ollama is `http://127.0.0.1:11434` and the model is `tinyllama`. That pair is the default even when `JEWBOT_MODEL` names something else. `OLLAMA_HOST` is used only when it is still a local address. A LAN host or a paid hostname is refused, including when `JEWBOT_ALLOW_PAID=1`.

`health()` pings `GET /api/tags` on that host after `assertLocalSpendOnly`. The probe uses `probeOllama` in `src/modules/llm/ollama.ts`.

`echo_task` sends one task through `chatOnce` in `src/modules/llm/ollama.ts` after `assertLocalSpendOnly`. A task that asks for a password, an API key, a private key, an OAuth or bearer token, or keystrokes is refused and does not open a socket. Echo does not call a cloud agent.

The old worker key stays owner-local. See `docs/migrations/echo.md`.

Env: `OLLAMA_HOST` (local only). Leave `JEWBOT_ALLOW_PAID` unset. This module ignores it. The model stays `tinyllama`.
