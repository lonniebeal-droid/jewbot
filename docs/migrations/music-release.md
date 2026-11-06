# Music Release Engine

Former role: a cloud agent that drafted and pushed a music release.

## What it does here

`src/modules/music-release` is a stub. Health is a local tags ping. It does not upload a release or talk to a distributor.

When wired, release notes are drafted with `moduleChat`. Uploading stays a separate owner step outside this module.

## What to port

- The release checklist (title, date, notes) as local fields or a markdown file in the project.
- The drafting prompt, pointed at local Ollama.

## What stays owner-local

- Distributor, store, and label API tokens
- Audio masters and unreleased stems if they are not meant to be in git
- The old cloud agent key

Do not commit those tokens. Do not add a distributor SDK to Jewbot.
