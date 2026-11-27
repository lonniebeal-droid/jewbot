# Street Trader

Local teaching module for the Atlanta gig-worker curriculum. `index.ts` exports `jewbotModule`. `manifest.ts` registers it. Version 0.3.0 adds curriculum retrieval and the local receipt log on top of the M8 module.

Tools:

- `street_ask` — one question through `src/modules/llm/ollama.ts` after `assertLocalSpendOnly`. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`. The reply cites a section from `curriculum/` and always carries the not-financial-advice line. If Ollama cannot be reached, the error is `local model offline`.
- `street_drive_log` — appends one receipt line to a local JSONL file. `exportDriveLog()` names the Master 3 continuation doc and does not call it.
- `street_outline` — the five topic areas (position sizing, risk management, chart reading, scam and pump-and-dump spotting, trading routine). No model call.
- `street_journal_prompt` — reflection prompts for a trade, a session, or a week. It does not write the journal.

`health()` pings local Ollama `/api/tags`. This module does not place orders, call a broker, or read an account. `sizePosition()` is local math for the 1% rule and the 25% cap. It does not look up a price.

A read-only markdown export of the curriculum ships in `curriculum/`. The Drive originals stay the source of truth and this module does not write back to them. URLs are in `docs/migrations/street-trader.md`. The prompt pack is `prompts.ts`. `src/modules/street_trader` is the spec-path alias.

Env: `OLLAMA_HOST` (local only), `JEWBOT_MODEL`. Leave `JEWBOT_ALLOW_PAID` unset. This module ignores it. `JEWBOT_STREET_DRIVE_LOG` overrides the JSONL path. `JEWBOT_STREET_DRIVE_EXPORT=1` still does not call Google; the exporter stays a stub.
