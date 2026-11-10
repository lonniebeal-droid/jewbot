# TwinRent

Local listing planner. `index.ts` exports `jewbotModule`. `manifest.ts` registers it. Version 0.2.0 replaces the M8 stub.

TwinRent's Ollama is `http://127.0.0.1:11434`. `OLLAMA_HOST` is used only when that host is still local. `JEWBOT_MODEL` picks the local model. A LAN host or a paid hostname is refused, including when `JEWBOT_ALLOW_PAID=1`.

`health()` pings `GET /api/tags` after `assertLocalSpendOnly`. The probe uses `probeOllama` in `src/modules/llm/ollama.ts`.

The checklist is `unit-facts`, `listing-note`, `owner-review`, and `publish`. `twinrent_list` and `twinrent_next` read it. `twinrent_mark` writes only step ids and statuses to `.jewbot/twinrent-plan.json` in the open project. The publish step stays blocked. This module does not publish, does not log into a rental site, and does not post a listing.

`twinrent_draft` sends unit facts through `chatOnce` in `src/modules/llm/ollama.ts` after `assertLocalSpendOnly`. Facts that contain credentials (a password, an API key, a private key, or an OAuth or bearer token), keystrokes, an email address, or a phone number are refused and do not open a socket. The draft is not published.

Platform tokens and tenant documents stay owner-local. See `docs/migrations/twinrent.md`.

Env: `OLLAMA_HOST` (local only), `JEWBOT_MODEL`. Leave `JEWBOT_ALLOW_PAID` unset. This module ignores it.
