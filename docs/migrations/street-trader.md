# Street Trader

Former role: a cloud trading agent. This module is the local teacher. It is not an order router.

## What it does here

`src/modules/street-trader` teaches from a system-prompt pack and short cached rules. `street_ask` calls `assertLocalSpendOnly` and then `chatOnce` in `src/modules/llm/ollama.ts`. A paid or non-local host is refused before any socket opens, including when `JEWBOT_ALLOW_PAID=1`. `health()` pings `/api/tags` on that same local host.

`street_outline` lists the five topic areas: position sizing, risk management, chart reading, scam and pump-and-dump spotting, and the trading routine. `street_journal_prompt` returns reflection questions. Neither tool calls a model or writes a file.

`sizePosition()` recomputes the curriculum size rules (1% risk, round down, 25% cap). It does not fetch a quote.

This build does not place orders, call a broker, or read an account.

## Drive source of truth (owner references, not downloaded)

The course already exists on the owner's Drive. Jewbot does not copy it into the repo and does not fetch it at runtime.

- Curriculum v1.1 (Atlanta gig workers, street voice): https://docs.google.com/document/d/1UDUxjOMcV7-_l1mSlPU3ggYzQKrf9vzyNSjobYpU0-M/edit
- 1-page cheat sheet: https://docs.google.com/document/d/1ANO1STpKBx1QILdMWuzbrqc-N2Zi7CxYaHDQ1sB-n6E/edit
- Trading journal template: https://docs.google.com/spreadsheets/d/1Mz6nauhxnv3KzMStauMy6wSu7E6kQC19psf__klgNJs/edit

Related owner docs, also not vendored: the local-module spec (`1_MosFHc_GDk8x00JsNmX8DSUrWtPXEbw3W5rQtiniKQ`) and the Atlanta gig one-pager (`1REicr6rRPUib0deIcnPtlXXnttvzCDK7H2uxqtAQkLw`).

## What stays owner-local

- Broker logins, API secrets, and account identifiers
- Live positions and anything that would move money
- The journal rows themselves (this module only suggests prompts)
- Master 3 claim logs. This module does not append to Drive

Those stay on the owner machine. The module does not ask for them.
