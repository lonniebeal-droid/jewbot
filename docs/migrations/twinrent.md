# Twinrent

Former role: a cloud agent for rental listings and tenant messages.

## What it does here

`src/modules/twinrent` is a local planner. Version 0.2.0 replaces the stub.

The checklist is unit facts, a listing-note draft, an owner review, and a publish step that stays blocked. `twinrent_list`, `twinrent_next`, and `twinrent_mark` use `.jewbot/twinrent-plan.json` in the open project. That file stores step ids and statuses only.

`health()` pings `GET /api/tags` after `assertLocalSpendOnly`. `twinrent_draft` sends unit facts through `chatOnce` in `src/modules/llm/ollama.ts` after the same gate. The default host is `http://127.0.0.1:11434`. A non-local host is refused even when `JEWBOT_ALLOW_PAID=1`.

Facts that contain credentials, keystrokes, an email address, or a phone number do not open a socket. The module does not publish a listing and does not log into a rental platform.

## What stays owner-local

- Rental-platform tokens and OAuth refresh tokens
- Tenant contact details and documents
- The old cloud agent key

Do not commit tenant data or platform tokens. `OLLAMA_HOST` is honored only when that host is still local. `JEWBOT_MODEL` picks the local model.
