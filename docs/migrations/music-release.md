# Music Release Engine

Former role: a cloud agent that drafted and pushed a music release.

This module is the local checklist for the JU Music weekly album pipeline. It does not upload a release, log into a store, or pay for distribution.

## What it does here

`src/modules/music-release` keeps a queue at `<project>/.jewbot/music-release.json`. `.jewbot/` is gitignored, so the live queue is not committed. `docs/examples/music-release.example.json` is the schema example.

Each release has an album title, an artist, a track list (a track may name its own artist), `notes`, and a status of `pending`, `blocked`, or `done`. `step` is the checklist position: `tracks`, `notes`, `ready`, then `distribute`.

Tools, local file only:

| Tool | Behavior |
|------|----------|
| `music_list_releases` | Read the queue. Returns copies. |
| `music_next_free` | Take the first `pending` release and advance one free step. |
| `music_mark` | Set `pending`, `blocked`, or `done`, and optional notes. |

`music_next_free` moves `tracks` → `notes` when the artist and at least one track title are present. It moves `notes` → `ready` when notes are already written. With `draft: true` and empty notes, it asks local Ollama for a short draft (`assertLocalSpendOnly` and `chatOnce` in `src/modules/llm/ollama.ts`). A model reply is stored as notes. It does not mark the release `done`.

When the free steps are finished, or the caller asks to upload, log in, or pay, the release becomes `blocked` and `step` is `distribute`. Nothing is sent to a distributor.

`health()` is the shared local `/api/tags` ping.

`addMusicRelease()` appends one pending release. It is a local writer, not a fourth distributor tool.

## Queue schema

`version` is `1`. `releases` is an array.

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | `rel_` plus 32 hex characters |
| `title` | yes | Album title |
| `artist` | yes | Album artist |
| `week` | no | ISO week, `2026-W45` |
| `tracks` | yes | `{ "title", "artist"? }[]`. `artist` is the track credit when it differs |
| `status` | yes | `pending`, `blocked`, or `done` |
| `step` | yes | `tracks`, `notes`, `ready`, or `distribute` |
| `notes` | yes | String. May be empty |
| `reason` | when blocked | Why a human has to take it from here |
| `createdAt`, `updatedAt` | yes | ISO timestamps |

Example (also `docs/examples/music-release.example.json`):

```json
{
  "version": 1,
  "releases": [
    {
      "id": "rel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "title": "Week 45",
      "artist": "JU Music",
      "week": "2026-W45",
      "tracks": [
        { "title": "Atlanta Night", "artist": "JU Music" },
        { "title": "Southbound" }
      ],
      "status": "pending",
      "step": "tracks",
      "notes": "",
      "createdAt": "2026-11-06T15:00:00.000Z",
      "updatedAt": "2026-11-06T15:00:00.000Z"
    },
    {
      "id": "rel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "title": "Week 44",
      "artist": "JU Music",
      "week": "2026-W44",
      "tracks": [{ "title": "Hold the Gate" }],
      "status": "blocked",
      "step": "distribute",
      "notes": "Local notes are ready. The owner still uploads this one.",
      "reason": "Human gate: DistroKid upload, Spotify for Artists, store login, and any payment stay with the owner. This module does not call those services and does not spend.",
      "createdAt": "2026-10-30T15:00:00.000Z",
      "updatedAt": "2026-11-06T15:00:00.000Z"
    }
  ]
}
```

A file that is not valid JSON, or not version `1`, is left untouched.

## Human gates

These stay with the owner. The module records `blocked` and a reason. It does not open a browser, call an API, or spend.

- DistroKid upload and any DistroKid plan payment
- Spotify for Artists, and any other store login (Apple Music, SoundCloud)
- Checkout, billing, or any other payment
- Marking a release `done` (only `music_mark` with `status: "done"`, after the owner finishes the gate)
- Drafts on a paid or non-local model host, including when `JEWBOT_ALLOW_PAID=1`

A down local Ollama leaves the release `pending` at `notes`. It does not invent notes and it does not call a paid model.

## What stays owner-local

- Distributor, store, and label API tokens
- Audio masters and unreleased stems if they are not meant to be in git
- The old cloud agent key
- The live `.jewbot/music-release.json` queue

Do not commit those tokens. Do not add a distributor SDK to Jewbot.
