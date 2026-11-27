/**
 * Bounded reads and hash readback, local and over a fake SFTP.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileWorkspace, MAX_READ_CHARS } from '../src/modules/files';
import { RemoteWorkspace, type SftpDirEntry, type SftpLike } from '../src/modules/remote';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

class MemorySftp implements SftpLike {
  files = new Map<string, string>();
  lie = false;
  async readdir(): Promise<SftpDirEntry[]> {
    return [];
  }
  async readFile(abs: string): Promise<Buffer> {
    const text = this.files.get(abs);
    if (text === undefined) throw new Error(`no such file: ${abs}`);
    return Buffer.from(this.lie ? `${text} tampered` : text);
  }
  async writeFile(abs: string, data: Buffer): Promise<void> {
    this.files.set(abs, data.toString('utf8'));
  }
  async stat(): Promise<{ isDirectory: boolean; size: number } | null> {
    return null;
  }
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-bound-'));
  const files = new FileWorkspace(root);
  try {
    const preview = await files.proposeEdit('note.txt', 'hello jewbot\n');
    await files.applyEdit(preview, true);
    expect((await files.read('note.txt')) === 'hello jewbot\n', 'local readback matches');

    const huge = 'x'.repeat(MAX_READ_CHARS + 1);
    await fs.writeFile(path.join(root, 'big.txt'), huge);
    let limited = false;
    try {
      await files.read('big.txt');
    } catch (err) {
      limited = /exceeds/.test(err instanceof Error ? err.message : '');
    }
    expect(limited, 'an oversized read fails');

    const sftp = new MemorySftp();
    sftp.files.set('/srv/app/note.txt', 'old\n');
    const remote = new RemoteWorkspace('pi', '/srv/app', sftp);
    const remotePreview = await remote.proposeEdit('note.txt', 'new\n');
    await remote.applyEdit(remotePreview, true);
    expect(await remote.read('note.txt') === 'new\n', 'sftp readback matches');
    sftp.lie = true;
    let mismatch = false;
    try {
      await remote.applyEdit(remotePreview, true);
    } catch (err) {
      mismatch = /Readback mismatch/.test(err instanceof Error ? err.message : '');
    }
    expect(mismatch, 'a mismatched SFTP readback fails');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('smoke-bounded: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
