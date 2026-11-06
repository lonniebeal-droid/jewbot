# Muse finisher

Muse is already on `main` (PR #8). The hub registers that module. It does not replace `src/modules/muse/index.ts`.

## What it does here

`MuseFinisherModule` and `runFinishLine()` return five release blockers and leave every one `open`. A local model may restate the list. It cannot close a blocker, start OAuth, or call production.

Fleet health and chat go through `src/modules/llm/ollama.ts` (`probeOllama`, `chatOnce`, `assertOllamaAllowed`) and `assertLocalSpendOnly`. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`.

## What to port

Nothing further for the checklist itself. Later work can add tools on the same `muse` id. Keep `listReleaseBlockers()` as the source of the five tasks.

## What stays owner-local

- Gmail and Calendar OAuth access tokens and refresh tokens
- Supabase service-role keys and any tenant database URL
- Session cookies or bearer tokens for the authenticated end-to-end chat test
- The private model URL and its credentials

None of those belong in this repository. The module does not read them.
