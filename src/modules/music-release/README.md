# Music Release Engine

Local checklist for Lonnie’s JU Music weekly album pipeline. `index.ts` exports a `JewbotModule` plus `musicListReleases`, `musicNextFree`, and `musicMark`. `manifest.ts` registers it.

The queue is `<project>/.jewbot/music-release.json`. That directory is gitignored. Copy `docs/examples/music-release.example.json` there to start a week. Schema and the human gates are in `docs/migrations/music-release.md`.

`health()` pings local Ollama `/api/tags`. Free steps stay on this machine: a track list and artist, then release notes. Empty notes can be drafted with local Ollama (`draft.ts` calls `assertLocalSpendOnly` and `chatOnce`). DistroKid, Spotify login, and any payment are marked `blocked` with a reason. This module does not upload a release and does not spend.

Env: `OLLAMA_HOST`, `JEWBOT_MODEL`. A non-local host is refused for drafts even when `JEWBOT_ALLOW_PAID=1`.
