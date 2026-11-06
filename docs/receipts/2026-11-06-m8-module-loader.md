# M8 module loader — receipt (2026-11-06)

Jewbot is the hub. Other bots register as modules and run on local Ollama. No paid SDKs. The real Muse finisher from PR #8 stays in `src/modules/muse/index.ts`. This change only adds `manifest.ts` and a README next to it. Tags `m5` and `m6` were not moved.

## What changed

- `src/modules/plugin` is the module API: `JewbotModule`, `registerModule`, `listModules`, `getModule`, `unregisterModule`. Boot loads `src/modules/*/manifest.ts` or `jewbot.module.json` and registers built-ins plus migration stubs. Schema: `docs/MODULE_API.md`.
- Hub chat goes through `moduleChat` / `moduleChatStream`, which call `assertLocalSpendOnly` and then `chatOnce` / `chatStream` in `src/modules/llm/ollama.ts`. Paid hostnames, including `x.ai` and `grok.com`, are refused unless `JEWBOT_ALLOW_PAID=1`. `OLLAMA_HOST` and `JEWBOT_MODEL` pick the local runtime.
- Muse health uses the existing `fleetHealth()` tags ping. Muse still refuses every non-local host when `JEWBOT_ALLOW_PAID=1`.
- Stubs (no cloud dependencies): `music-release`, `fleet-triage`, `street-trader`, `twinrent`, `portfolio-sweeper`, `echo`. Each has `index.ts`, `manifest.ts`, a folder README, and `docs/migrations/<id>.md`. Health is a local `/api/tags` ping.
- The window has a Modules panel: registered modules and health `ok` or `down`.

## Migration order

1. muse
2. fleet-triage
3. portfolio-sweeper
4. echo
5. music-release
6. street-trader
7. twinrent

Muse is already integrated. Fleet triage and the portfolio sweeper are ops. Echo is the general worker. The product bots (music release, street trader, twinrent) come last. Secrets for each stay owner-local. See `docs/migrations/`.

## Test commands and results

Run from this branch, Node 22, no live Ollama:

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
# smoke-m8: PASS

npm run test:ui
# exit 0
# milestone M8
# modulesReady true, moduleCount 15
# Ollama unreachable in this environment; the ping path showed the usual "Cannot reach Ollama" error
```

`npm run test:m8` covers register, list, get, unregister, duplicate and bad ids, discovery of the real tree plus a JSON manifest, the real Muse class still exporting five open blockers, boot without duplicate registration, paid-host refusal for OpenAI, Anthropic, `api.x.ai`, `grok.x.ai`, and `api.grok.com` with zero fetches unless `JEWBOT_ALLOW_PAID=1`, a local chat that is allowed, stub health sharing one mocked tags ping, and Muse still refusing a paid host when the flag is set.

The UI smoke logs dbus connection errors from Electron in this environment. The process still exited 0.

## Known limits

- Stubs do not run the old bots. They register, report health, and document what to port. Tools named in the stubs are not wired.
- Muse does not close its five blockers. OAuth tokens and Supabase keys stay outside the repo.
- The Modules panel shows `ok` or `down`. It does not start a stub’s former cloud job.
- `JEWBOT_ALLOW_PAID=1` can open a non-local host for `moduleChat`. Leave it unset. Muse does not honor it.
- The automated tests never call a live Ollama or a paid API.

## What the owner must do

1. Review this PR. Do not merge until you want the hub on `main`. Do not move tags `m5` or `m6`.
2. After it is on `main`, tag that commit `m8` if you want a tag. Do not tag this feature branch.
3. `npm start` with `ollama serve`. The Modules panel should list the built-ins, Muse, and the six stubs. Chat-capable rows are `ok` when `/api/tags` answers and `down` when it does not.
