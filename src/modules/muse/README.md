# Muse finisher

This folder is the real Muse module from PR #8. `index.ts` exports `MuseFinisherModule` and `runFinishLine()`. `manifest.ts` only registers that module with the hub.

Health uses `fleetHealth()`, which pings local Ollama `/api/tags`. Chat, when the finish line asks for a restatement, uses `fleetChat()` (`chatOnce` in `ollama.ts` plus `assertLocalSpendOnly`). A non-local host is refused even if `JEWBOT_ALLOW_PAID=1`.

The five release blockers stay `open`. OAuth tokens and Supabase keys stay owner-local. See `docs/migrations/muse.md`.
