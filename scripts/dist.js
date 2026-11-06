#!/usr/bin/env node
'use strict';

/**
 * Package the current tree with electron-builder.
 *
 * Code signing and notarization are forced off. Turning them on costs money
 * and is an owner decision (see README, Install).
 *
 * With no --x64/--arm64 flag, only the host architecture is built, so
 * `npm run dist` does not cross-compile node-pty. Pass an arch flag to
 * override (the CI matrix does this on a matching runner).
 *
 * Native modules are rebuilt twice on purpose: `electron-builder install-app-deps`
 * runs @electron/rebuild for the host, then the pack step rebuilds again for
 * the target arch (npmRebuild in electron-builder.yml).
 */

const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
for (const key of [
  'CSC_LINK',
  'WIN_CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN_PROFILE',
]) {
  delete process.env[key];
}

const extra = process.argv.slice(2);
const archFlags = ['--x64', '--arm64', '--ia32', '--armv7l', '--universal'];
const hasArch = extra.some((arg) => archFlags.includes(arg));
const hostArch = os.arch() === 'arm64' ? '--arm64' : os.arch() === 'ia32' ? '--ia32' : '--x64';

function hasPlatformFlag(args) {
  return args.some((arg) =>
    ['--linux', '--mac', '--win', '--macos', '--windows', '-l', '-m', '-w', '-o'].includes(arg),
  );
}

function hostPlatformArgs() {
  if (process.platform === 'darwin') return ['--mac', 'dmg', 'zip'];
  if (process.platform === 'win32') return ['--win', 'nsis'];
  return ['--linux', 'AppImage', 'deb'];
}

const builder = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js');
const platformArgs = hasPlatformFlag(extra) ? [] : hostPlatformArgs();
const buildArgs = [
  builder,
  '--publish',
  'never',
  ...platformArgs,
  ...(hasArch ? [] : [hostArch]),
  ...extra,
];

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);
}

// ssh2's optional sshcrypto.node calls OpenSSL symbols (ERR_set_mark) that
// Electron's BoringSSL does not export. A module built for plain Node fails
// to self-register; one built against system OpenSSL aborts the process on
// first use. ssh2 already catches a missing addon and uses its JS crypto.
// Drop the binary so the package takes that path on purpose.
function removeSshCryptoAddon() {
  const addon = path.join(
    __dirname,
    '..',
    'node_modules',
    'ssh2',
    'lib',
    'protocol',
    'crypto',
    'build',
    'Release',
    'sshcrypto.node',
  );
  const fs = require('fs');
  if (fs.existsSync(addon)) {
    fs.rmSync(addon);
    console.log('removed sshcrypto.node (ssh2 JS crypto fallback; see README)');
  }
}

run([builder, 'install-app-deps']);
removeSshCryptoAddon();
run(buildArgs);
