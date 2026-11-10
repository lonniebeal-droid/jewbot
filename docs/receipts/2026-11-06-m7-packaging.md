# M7 packaging — receipt (2026-11-06)

Milestone M7 packages Jewbot from current `main` (`bbad481`). Tags `m5` and `m6` already point at that commit on the remote. This work does not create, move, or push them, and it does not publish a release.

No paid APIs. Installers are unsigned. Code signing and Apple notarization stay off because they cost money. That is an owner decision.

## What changed

- `electron-builder.yml` (electron-builder 26.18.0, Electron 35.7.5 from the lockfile):
  - macOS: dmg and zip, arm64 and x64. `identity: null`, `notarize: false`, hardened runtime off.
  - Linux: AppImage and deb, x64 and arm64 (Raspberry Pi). `executableName` is `jewbot`.
  - Windows: NSIS, x64 only. No certificate. `CSC_IDENTITY_AUTO_DISCOVERY` is forced off by `scripts/dist.js`.
  - `publish: null`. Scripts pass `--publish never`.
- npm scripts: `dist` (this OS, this CPU), `dist:linux`, `dist:mac`, `dist:win`, and `rebuild:native`. Each dist script builds, runs `electron-builder install-app-deps` (`@electron/rebuild`) for `node-pty` and ssh2's optional `cpu-features`, then packs only the selected arch so a laptop does not cross-compile native addons.
- App version is `package.json` `0.1.0`. The window title, header badge, Ollama panel, and About dialog show it. `--jewbot-version` prints it and exits.
- `.github/workflows/build.yml`: pull requests run `npx tsc --noEmit` and `npm test` on `ubuntu-latest`. A `v*` tag builds ubuntu x64, ubuntu arm64 (`ubuntu-24.04-arm`), macOS arm64, macOS Intel (`macos-15-intel`), and Windows x64. Those are standard hosted runners, free on a public repo. The installers are attached to a **draft** GitHub Release. If that tag is already a published release, the job stops and does not upload. `GITHUB_TOKEN` is the automatic workflow token. No repository secrets.
- `CHANGELOG.md` covers M0 through M7. README has a per-OS install section, including the Pi (Ollama plus `qwen2.5-coder:1.5b`). `docs/MILESTONES.md` marks M7 done and proposes M8.

## Native modules

`@electron/rebuild` during `npm run dist` reported, for Electron 35.7.5 x64:

```text
preparing moduleName=cpu-features arch=x64
finished  moduleName=cpu-features arch=x64
preparing moduleName=node-pty arch=x64
finished  moduleName=node-pty arch=x64
```

The unpacked app contains ELF x86-64 `pty.node` and `cpufeatures.node`. Inside the AppImage, `--jewbot-version` printed `node-pty: loaded` and `cpu-features: loaded`.

ssh2's other optional addon, `sshcrypto.node`, is not packaged. It calls OpenSSL symbols such as `ERR_set_mark`. Electron's headers tarball does not include OpenSSL headers, and a module compiled against the system OpenSSL 3 headers aborted Electron with `undefined symbol: ERR_set_mark`. A Node-ABI build fails with "did not self-register". ssh2 already catches a missing addon and uses its JavaScript crypto. `scripts/dist.js` removes `sshcrypto.node` before packing, and `electron-builder.yml` excludes `**/sshcrypto.node`. The version line prints `sshcrypto: js-fallback`.

## Commands and results

Run on this Linux x64 VM (Node 22.23.4). Ollama was not running. D-Bus connection errors from Electron are noise; the processes still exited 0.

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

xvfb-run -a npm run test:ui
# exit 0
# milestone M7, version 0.1.0
# About text includes "unsigned" and "Notarization: off"

npm run dist
# exit 0
# electron-builder 26.18.0
# AppImage: release/Jewbot-0.1.0-linux-x86_64.AppImage
# deb:      release/Jewbot-0.1.0-linux-amd64.deb
```

Artifact sizes (`stat`):

| File | Bytes |
|------|------:|
| `Jewbot-0.1.0-linux-x86_64.AppImage` | 114206321 (109M) |
| `Jewbot-0.1.0-linux-amd64.deb` | 89380688 (86M) |

AppImage launch. This container refuses FUSE mounts (`fusermount: mount failed: Operation not permitted`) even with `libfuse.so.2` installed, so the smoke used the AppImage's own extract-and-run path:

```text
./release/Jewbot-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run --no-sandbox --disable-gpu --jewbot-version
# exit 0
# jewbot 0.1.0
# milestone M7
# electron 35.7.5
# platform linux x64
# signing off
# notarization off
# node-pty: loaded
# cpu-features: loaded
# sshcrypto: js-fallback

JEWBOT_LAUNCH_SMOKE=1 xvfb-run -a \
  ./release/Jewbot-0.1.0-linux-x86_64.AppImage --appimage-extract-and-run --no-sandbox --disable-gpu
# exit 0
# JEWBOT_LAUNCH_OK 0.1.0 linux x64
```

`JEWBOT_LAUNCH_OK` means the packaged window reached `did-finish-load` and then exited.

## Known limits

- macOS and Windows installers were not built on this VM. The workflow builds them on tag push. They are unsigned, so Gatekeeper and SmartScreen warn until the owner opens them anyway.
- Linux arm64 (Pi) is configured and the tag workflow builds it on `ubuntu-24.04-arm`. It was not built on this x64 VM. `npm run dist:linux` on the Pi builds that arch.
- `npm run dist` builds one architecture: the machine's own, or the `--x64` / `--arm64` flag you pass. CI passes one arch per runner. This VM built x64 only.
- `sshcrypto.node` is omitted. SSH uses ssh2's JavaScript crypto. `cpu-features` still loads.
- FUSE must work for a normal AppImage double-click (`libfuse2` / `fusermount`). If the mount is blocked, `--appimage-extract-and-run` still starts the same bits.
- The draft release is created only after a `v*` tag is pushed. This branch does not push that tag. Publishing the draft is a separate owner click.
- Ollama is not bundled. A Pi should use a small model (`qwen2.5-coder:1.5b`).

## What the owner must do

1. Review the PR. Do not treat it as merged.
2. After it is on `main`, tag that commit `m7` if you want a milestone tag. Leave `m5` and `m6` where they are (`bbad481`).
3. Push a version tag such as `v0.1.0` only when you want the draft installers. The workflow will not publish the release.
4. On a Mac, a Windows PC, and a 64-bit Pi, open the unsigned installer once and confirm Gatekeeper or SmartScreen behaves as you expect. Signing is still off until you decide to pay for it.
