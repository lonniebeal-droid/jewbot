# Street Trader module — receipt (2026-11-06)

Replaces the M8 stub with a local teaching module on current `main` (after PR #11). No paid APIs. The smoke mocks `fetch`. Nothing in this change places a trade, calls a broker, or copies the Drive curriculum into the repo.

## What changed

- `src/modules/street-trader` is no longer a stub. `street_ask` calls `assertLocalSpendOnly` and then `chatOnce` in `src/modules/llm/ollama.ts`. A non-local host, including Grok and xAI, throws before a socket opens, even when `JEWBOT_ALLOW_PAID=1`.
- Every ask, outline, and journal result carries the not-financial-advice line. An order or broker-login request is refused with no model call.
- `street_outline` lists five areas: position sizing, risk management, chart reading, scam and pump-and-dump spotting, and the trading routine. No model call.
- `street_journal_prompt` returns reflection prompts for a trade, a session, or a week. It does not write the journal.
- `sizePosition()` recomputes the 1% rule and the 25% cap for the three curriculum fixtures. It does not look up a price.
- `health()` pings local Ollama `/api/tags`. The hub still registers `street-trader` from `manifest.ts`.
- `npm test` runs `npm run test:street` after the fleet smoke.

## Drive source of truth (owner references, not downloaded)

- Curriculum v1.1: https://docs.google.com/document/d/1UDUxjOMcV7-_l1mSlPU3ggYzQKrf9vzyNSjobYpU0-M/edit
- Cheat sheet: https://docs.google.com/document/d/1ANO1STpKBx1QILdMWuzbrqc-N2Zi7CxYaHDQ1sB-n6E/edit
- Journal template: https://docs.google.com/spreadsheets/d/1Mz6nauhxnv3KzMStauMy6wSu7E6kQC19psf__klgNJs/edit

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
# smoke-m8: PASS
# smoke-fleet: PASS
# smoke-street-trader: PASS
```

`npm run test:street` checks paid-host refusal (OpenAI, Anthropic, xAI, Grok, and a LAN host) with zero fetches even when `JEWBOT_ALLOW_PAID=1`, a mocked local answer that still leads with the disclaimer, an order request that does not fetch, the five outline topics, journal prompts, the three size fixtures, and a tags ping that refuses a paid host.

`npm run test:ui` was not run. This change does not touch the Electron window. Packaging files from open PR #10 were not edited.

## Known limits

- The full curriculum stays on Drive. The repo holds a prompt pack and short cached rules, not the course text.
- Street Trader does not place trades, store broker keys, or append a Master 3 claim.
- A machine without `ollama serve` still returns the outline and journal prompts. `street_ask` and health report that the local model was not reached.
- The automated tests never call a live Ollama or a paid API.

## What the owner must do

1. Review this PR. Leave the merge until CI is green.
2. Do not put broker logins, account numbers, or journal rows into the repo.
