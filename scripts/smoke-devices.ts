/**
 * Per-device SSH identity. The key path is stored. The key bytes are not.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadHostsFile, parseHostEntry } from '../src/modules/ssh/config';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-devices-'));
  const macKey = path.join(dir, 'id_mac');
  const dellKey = path.join(dir, 'id_dell');
  const secret = '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-bytes\n-----END OPENSSH PRIVATE KEY-----\n';
  await fs.writeFile(macKey, secret);
  await fs.writeFile(dellKey, secret.replace('secret-bytes', 'other-bytes'));
  const hosts = path.join(dir, 'hosts.json');
  await fs.writeFile(
    hosts,
    JSON.stringify({
      hosts: [
        {
          name: 'mac',
          host: '127.0.0.1',
          username: 'lonnie',
          privateKeyPath: macKey,
          tailscale_ip: '100.64.0.2',
          tailscale_hostname: 'mac',
          os: 'macOS',
          role: 'primary LLM worker',
        },
        {
          name: 'dell',
          device: 'dell',
          host: '192.168.1.20',
          username: 'lonnie',
          privateKeyPath: dellKey,
          tailscale_ip: '100.95.0.4',
          tailscale_hostname: 'dell',
        },
      ],
    }),
  );
  try {
    const loaded = loadHostsFile(hosts);
    expect(loaded.error === null && loaded.hosts.length === 2, loaded.error || 'count');
    const [mac, dell] = loaded.hosts;
    expect(mac.device === 'mac' && dell.device === 'dell', 'device ids');
    expect(mac.privateKeyPath === macKey && dell.privateKeyPath === dellKey, 'each device has its own key path');
    expect(mac.tailscale_ip === '100.64.0.2' && mac.tailscale_hostname === 'mac', 'tailscale fields');
    const dumped = JSON.stringify(loaded.hosts);
    expect(!dumped.includes('secret-bytes') && !dumped.includes('BEGIN OPENSSH'), 'key contents are not loaded');

    let inline = false;
    try {
      parseHostEntry({ name: 'pi', host: '127.0.0.1', username: 'pi', privateKey: secret }, 0, new Set());
    } catch (err) {
      inline = /must not store privateKey/.test(err instanceof Error ? err.message : '');
    }
    expect(inline, 'an inline private key is refused');

    let publicIp = false;
    try {
      parseHostEntry(
        { name: 'pi', host: '127.0.0.1', username: 'pi', agent: true, tailscale_ip: '8.8.8.8' },
        0,
        new Set(),
      );
    } catch (err) {
      publicIp = /100\.64\.0\.0\/10/.test(err instanceof Error ? err.message : '');
    }
    expect(publicIp, 'a public address is not a Tailscale IP');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('smoke-devices: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
