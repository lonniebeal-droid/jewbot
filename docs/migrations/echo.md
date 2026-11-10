# Echo

Former role: a general cloud worker that took a task and returned a result.

## What it does here

`src/modules/echo` is a local worker. Version 0.2.0 replaces the stub.

Echo's Ollama is `http://127.0.0.1:11434` and the model is `tinyllama`. `health()` pings `GET /api/tags` after `assertLocalSpendOnly`. `echo_task` sends one task through `chatOnce` in `src/modules/llm/ollama.ts` after the same gate. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`. A task that asks for credentials or keystrokes does not open a socket.

There is no hosted agent endpoint.

## What stays owner-local

- The old worker’s API key
- Webhook secrets and callback URLs that embed tokens
- Per-user data the cloud worker stored outside this repo

Do not recreate the paid client. Echo does not read `JEWBOT_MODEL`. `OLLAMA_HOST` is honored only when that host is still local.
