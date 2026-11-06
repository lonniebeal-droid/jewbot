# Music release checklist — receipt (2026-11-06)

The music module is a local checklist for the JU Music weekly album pipeline. It sits on current `main` after fleet triage (PR #11, `1cd9421`). No DistroKid, Spotify, or payment call. This PR is not merged.

## What changed

- `src/modules/music-release` is no longer a stub. The queue is `<project>/.jewbot/music-release.json` (`.jewbot/` is gitignored). The schema and a copyable example are in `docs/migrations/music-release.md` and `docs/examples/music-release.example.json`.
- Each release stores an artist, track list, notes, and `pending` | `blocked` | `done`. Free steps are `tracks`, then `notes`, then `ready`.
- `music_list_releases`, `music_next_free`, and `music_mark` are on the module and in the agent loop. They only read and write that file. `music_next_free` advances one free step. Empty notes can be drafted with `draft: true`.
- Drafts call `assertLocalSpendOnly` and `chatOnce` in `src/modules/llm/ollama.ts`. A non-local or paid host is refused before fetch, including when `JEWBOT_ALLOW_PAID=1`. The agent ignores a `host` argument on these tools.
- DistroKid upload, store login, and payment mark the release `blocked` with a reason. The module never sets `done` from model text or from `music_next_free`. `music_mark` with `status: "done"` is the owner’s record after they finish that gate themselves.
- `health()` is the shared local `/api/tags` ping.

## Test commands and results

Run from this branch, Node v22.23.4, no live Ollama:

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
# smoke-music: PASS

npm run test:ui
# exit 0
# milestone M8
# modulesReady true, moduleCount 15
# Ollama unreachable in this environment; the ping path showed the usual "Cannot reach Ollama" error
```

`npm run test:music` uses a temp directory and mocked `fetch`. It covers an empty queue, a corrupt file left untouched, track-list then notes then the distributor gate, a draft that says the album was uploaded (status stays `pending`), existing notes with zero fetches, paid and LAN hosts refused with zero fetches even when `JEWBOT_ALLOW_PAID=1`, upload and pay intents that cannot mark `done`, the example JSON, and the agent tools ignoring a paid `host` while a DistroKid upload stays blocked.

The UI smoke logs dbus connection errors from Electron in this environment. The process still exited 0.

## Human gates

- DistroKid upload and any DistroKid plan payment
- Spotify for Artists and any other store login
- Checkout, billing, or any other payment
- Marking a release `done` (owner `music_mark` only, after the gate above)
- Drafts on a paid or non-local model host, including when `JEWBOT_ALLOW_PAID=1`

## Known limits

- Audio masters, stems, and distributor tokens are not read. They stay on the owner machine.
- A down local Ollama leaves the release `pending` at the notes step. It does not invent notes.
- The agent does not receive a control that can point these tools at a paid host.
- The automated tests never call a live Ollama, DistroKid, Spotify, or a payment API.

## What the owner must do

1. This PR is not merged. Parent merges when CI is green.
2. Keep the live queue in `.jewbot/music-release.json`. Do not commit distributor tokens or masters.
3. After a real upload, mark that release `done` yourself. The module will not do it.
