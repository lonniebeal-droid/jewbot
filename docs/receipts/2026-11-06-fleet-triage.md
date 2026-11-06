# Fleet triage — receipt (2026-11-06)

Fleet triage is a local module on top of `main` after PR #9 (`02fa3f58`). It checks Ollama on localhost and on allowlisted SSH hosts. No paid API. This PR is not merged.

## What changed

- `src/modules/fleet-triage` is no longer a stub. `fleet_list` and `fleet_health` are on the module `tools` array and in the agent loop.
- Local health uses `probeOllama` (`GET /api/tags`). Each allowlisted remote runs `curl -s http://127.0.0.1:11434/api/tags` through `SshManager.exec`. `checkShellCommand` runs first. A destructive command is `BLOCKED` and is not sent. The tool ignores `command`, `approved`, and `executionId`.
- Membership comes from `~/.jewbot/fleet.json` (`JEWBOT_FLEET`) when that file exists, otherwise localhost plus `~/.jewbot/hosts.json`. The schema is in `docs/migrations/fleet-triage.md`. Secret fields are rejected and the value is not copied into the error.
- A non-local or paid Ollama URL is refused even when `JEWBOT_ALLOW_PAID=1`. Remote machines are not fetched over the LAN. SSH reaches them, then curl talks to loopback on that machine.
- The Modules panel `health()` is still the shared local tags ping. Opening the panel does not open SSH.

## Test commands and results

Run from this branch, Node v22.23.4, no live Ollama and no real SSH:

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

npm run test:ui
# exit 0
# milestone M8
# modulesReady true, moduleCount 15
# Ollama unreachable in this environment; the ping path showed the usual "Cannot reach Ollama" error
```

`npm run test:fleet` mocks `fetch` and the scripted SSH client. It covers a secret field left out of the error, a paid Ollama URL refused with zero fetches, implicit and explicit host lists, a remote tags curl, a host that is not allowlisted, a destructive command that never reaches `onExec`, an existing SSH session left open, panel health sharing one tags ping, and the agent tools ignoring `command` / `approved` / `executionId`.

The UI smoke logs dbus connection errors from Electron in this environment. The process still exited 0.

## Known limits

- Disk and failed systemd timers are named in `FLEET_SIGNALS` and are not collected.
- `fleet_health` does not write a model ranking. A later note can use `moduleChat`.
- The remote probe assumes `curl` on that machine and Ollama on `127.0.0.1:11434`.
- The first SSH connection still needs the owner to trust the host key. A missing key passphrase prompt is reported as refused.
- The automated tests never call a live Ollama, a paid API, or a real SSH server.

## What the owner must do

1. Review this PR. Do not merge until you want fleet triage on `main`.
2. Keep `~/.jewbot/hosts.json` and `~/.jewbot/fleet.json` on the machine. Do not commit them.
3. `npm start` with `ollama serve`. Ask the agent for `fleet_health` after the SSH hosts are allowlisted.
