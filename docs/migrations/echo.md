# Echo

Former role: a general cloud worker that took a task and returned a result.

## What it does here

`src/modules/echo` is a stub. Health pings local Ollama. The `echo_task` tool is reserved.

When wired, a task string goes to `moduleChat` (`assertLocalSpendOnly` plus `chatOnce` in `ollama.ts`). There is no hosted agent endpoint.

## What to port

- The task prompt and the expected reply shape.
- Any tool that only needs the Jewbot terminal, files, or SSH modules, behind the same confirmation gates.

## What stays owner-local

- The old worker’s API key
- Webhook secrets and callback URLs that embed tokens
- Per-user data the cloud worker stored outside this repo

Do not recreate the paid client. `OLLAMA_HOST` and `JEWBOT_MODEL` are the runtime.
