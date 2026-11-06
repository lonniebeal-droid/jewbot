# Street Trader

Local teaching module for the Atlanta gig-worker curriculum. `index.ts` exports `jewbotModule`. `manifest.ts` registers it. Version 0.2.0 replaces the M8 stub.

Tools:

- `street_ask` — one question through `src/modules/llm/ollama.ts` after `assertLocalSpendOnly`. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`. The reply always carries the not-financial-advice line.
- `street_outline` — the five topic areas (position sizing, risk management, chart reading, scam and pump-and-dump spotting, trading routine). No model call.
- `street_journal_prompt` — reflection prompts for a trade, a session, or a week. It does not write the journal.

`health()` pings local Ollama `/api/tags`. This module does not place orders, call a broker, or read an account. `sizePosition()` is local math for the 1% rule and the 25% cap. It does not look up a price.

The full curriculum v1.1, the cheat sheet, and the journal stay on the owner Drive. URLs are in `docs/migrations/street-trader.md`. The prompt pack is `prompts.ts`.

Env: `OLLAMA_HOST` (local only), `JEWBOT_MODEL`. Leave `JEWBOT_ALLOW_PAID` unset. This module ignores it.
