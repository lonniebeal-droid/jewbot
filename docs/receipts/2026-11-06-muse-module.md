# Muse finisher module — receipt (2026-11-06)

Adds a local Muse module on `main` (`bbad481`). No paid APIs. The smoke mocks `fetch`. Nothing in this change closes a release blocker, starts OAuth, or touches production.

## What changed

- `src/modules/muse` exports `MuseFinisherModule` and `runFinishLine()`. The finish line returns five typed tasks and leaves every one `open`. A local model reply can restate the list. It cannot mark a task done.
- The five blockers are: a private authenticated model URL with no Lovable gateway, live Gmail and Calendar OAuth, an authenticated end-to-end chat test, Supabase row-level security isolation, and the production gate blockers recorded on 2026-10-16.
- Fleet health and chat are a thin wrapper around the existing Ollama helpers (`defaultOllamaConfig`, `probeOllama`, `chatOnce`, `assertOllamaAllowed`). Default host is `http://127.0.0.1:11434`. `OLLAMA_HOST` and `JEWBOT_MODEL` apply only when the host is still local. Any other host calls `assertLocalSpendOnly` and is refused, including when `JEWBOT_ALLOW_PAID=1`. No vendor endpoint is hardcoded.
- Gmail and Calendar OAuth tokens are not read, written, or committed. The module does not connect to Supabase and does not run a shell command.
- `src/modules/index.ts` exports the module as `muse`.

## Test commands and results

Run from this branch, Node 22, no Ollama required:

```text
npx tsc --noEmit
# exit 0

npm test
# smoke-safety: PASS
# smoke-m1: PASS
# smoke-m2: PASS
# smoke-m3: PASS
# smoke-m4: PASS
# smoke-m5: PASS
# smoke-m6: PASS
# smoke-muse: PASS
```

`npm run test:muse` checks the five open blockers, default host and `JEWBOT_MODEL`, mocked fleet health and chat, a model reply that says the blockers are done (they stay open), a down fleet, and a non-local host that is refused with zero fetches. An OAuth-shaped environment value is not sent to the fleet and does not appear in the report.

`npm run test:ui` was not run. This change does not touch the Electron window.

## Known limits

- Muse does not close the five blockers. OAuth, the authenticated end-to-end test, RLS, and the 2026-10-16 production gate stay owner work outside this module.
- Review traffic is local Ollama only. A machine without `ollama serve` still gets the checklist; the fleet section reports that the model was not reached.
- The automated tests never call a live Ollama or a paid API.

## What the owner must do

1. Review this draft. Do not merge it to `main` until you want it.
2. Do not put Gmail or Calendar tokens, Supabase keys, or a private model URL into the repo.
