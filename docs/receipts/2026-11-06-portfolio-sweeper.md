# Portfolio sweeper module — receipt (2026-11-06)

Turns the M8 portfolio-sweeper stub into a local checklist for JU Portfolio production-readiness gates. No paid APIs. The smoke mocks `fetch`. Marking a gate writes status into `.jewbot/portfolio-gates.json` and does not deploy.

PR #10 (unsigned installers) is open. This change does not edit the packaging workflow, `electron-builder.yml`, icons, or the window. `package.json` only gains `test:portfolio` on the existing `npm test` chain.

## What changed

- `src/modules/portfolio-sweeper` reads `.jewbot/portfolio-gates.json` (gitignored). When that file is missing, `portfolio_list_gates` and `portfolio_next_free` use the bundled checklist in `checklist.ts` and write nothing. The same checklist is in `docs/migrations/portfolio-sweeper.md`.
- `portfolio_mark_gate` sets one gate to `open`, `blocked`, or `done`. Other fields stay as they were. The result’s `deployed` flag is false. A missing file is created from the bundled checklist. A symlink for `.jewbot/` or the gate file is refused, and a bad file is left untouched.
- `portfolio_next_free` returns the next gate whose status is `open` and whose blocker is not `owner` or `human`.
- `health()` calls `assertLocalSpendOnly(false)` and `probeOllama` in `src/modules/llm/ollama.ts` (`GET /api/tags`). A paid or non-local host is refused, including when `JEWBOT_ALLOW_PAID=1`, and no socket is opened. The gate file is not sent to a model.
- `manifest.ts` still registers `jewbotModule`. Muse and the plugin registry are unchanged. The module id stays `portfolio-sweeper`.

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
# smoke-portfolio: PASS

npm run test:ui
# exit 0
# milestone M8
# modulesReady true, moduleCount 15
# Ollama unreachable in this environment; the ping path showed the usual "Cannot reach Ollama" error
```

`npm run test:portfolio` checks the bundled six gates against the migration doc, list/mark/next on a temp root, owner and human blockers skipped by `portfolio_next_free`, status-only writes, invalid JSON and version left untouched, symlink escapes, and a mocked tags ping. Paid hosts (`api.openai.com`, `api.x.ai`, `grok.x.ai`, `api.grok.com`) and a LAN host are refused with zero fetches even when `JEWBOT_ALLOW_PAID=1`.

The UI smoke logs dbus connection errors from Electron in this environment. The process still exited 0.

## Known limits

- The module records gate status. It does not read a brokerage, place an order, send money, or deploy.
- A summary of a local portfolio folder is not wired yet. If one is added later, it has to go through `moduleChat` and must not include account identifiers.
- `JEWBOT_ALLOW_PAID=1` does not let this module’s health contact a non-local host.
- The automated tests never call a live Ollama or a paid API.

## What the owner must do

1. Review this PR. Do not merge it until you want the local sweeper on `main`.
2. Keep brokerage logins, API keys, account numbers, and statements out of git. The gate file stays under `.jewbot/`.
