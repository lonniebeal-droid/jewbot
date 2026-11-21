/**
 * M15 remote workspace smoke. In-memory SFTP. No live SSH server.
 */
import { FileWorkspace } from '../src/modules/files';
import { assertAllowlisted, RemoteWorkspace, remoteCommandGate, type SftpDirEntry, type SftpLike } from '../src/modules/remote';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

class MemorySftp implements SftpLike {
  files = new Map<string, string>([['/srv/app/README.md', 'hello remote\n']]);
  dirs = new Set(['/srv/app', '/srv/app/src', '/srv/app/node_modules']);

  async readdir(abs: string): Promise<SftpDirEntry[]> {
    if (!this.dirs.has(abs)) throw new Error(`no such file: ${abs}`);
    const prefix = abs === '/' ? '/' : `${abs}/`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0]);
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix) && dir !== abs) names.add(dir.slice(prefix.length).split('/')[0]);
    }
    return [...names].filter(Boolean).map((filename) => ({
      filename,
      isDirectory: this.dirs.has(`${prefix}${filename}`.replace(/\/+/g, '/').replace(/\/$/, '') === '/' ? '/' : prefix + filename),
      size: this.files.get(prefix + filename)?.length ?? 0,
    }));
  }

  async readFile(abs: string): Promise<Buffer> {
    const text = this.files.get(abs);
    if (text === undefined) throw new Error(`no such file: ${abs}`);
    return Buffer.from(text);
  }

  async writeFile(abs: string, data: Buffer): Promise<void> {
    this.files.set(abs, data.toString('utf8'));
  }

  async stat(abs: string): Promise<{ isDirectory: boolean; size: number } | null> {
    if (this.dirs.has(abs)) return { isDirectory: true, size: 0 };
    const text = this.files.get(abs);
    if (text === undefined) return null;
    return { isDirectory: false, size: text.length };
  }
}

async function testJailAndEdit() {
  const sftp = new MemorySftp();
  sftp.files.set('/srv/app/src/main.ts', 'export const n = 1;\n');
  sftp.files.set('/srv/app/node_modules/pkg/index.js', 'secret\n');
  const workspace = new RemoteWorkspace('pi', '/srv/app', sftp);
  let escaped = false;
  try {
    workspace.resolve('../etc/passwd');
  } catch (err) {
    escaped = /escapes/.test(err instanceof Error ? err.message : '');
  }
  expect(escaped, 'parent path is refused');
  const listing = await workspace.listDir('.');
  expect(listing.includes('README.md') && listing.includes('src/'), listing.join());
  expect(!listing.includes('node_modules/'), 'vendor dir is hidden');
  const hits = await workspace.search('export const');
  expect(hits[0]?.path === 'src/main.ts' && hits[0].line === 1, JSON.stringify(hits));
  const preview = await workspace.proposeEdit('README.md', 'hello remote\n\nmore\n');
  expect(preview.unchanged === false, 'preview is a diff');
  let wrote = false;
  try {
    await workspace.applyEdit(preview, false);
  } catch {
    wrote = true;
  }
  expect(wrote && (await workspace.read('README.md')) === 'hello remote\n', 'reject does not write');
  await workspace.applyEdit(preview, true);
  expect(await workspace.read('README.md') === 'hello remote\n\nmore\n', 'accept writes over sftp');
}

function testTerminalGate() {
  const safe = remoteCommandGate('/srv/app', 'npm test');
  expect(safe.command.startsWith("cd '/srv/app' && npm test"), safe.command);
  expect(safe.ok === true, 'npm test is not destructive');
  const danger = remoteCommandGate('/srv/app', 'rm -rf /tmp/nope');
  expect(danger.needsConfirmation === true, 'rm -rf still needs the grant');
  expect(assertAllowlisted([{ name: 'pi' }], 'pi') === undefined, 'pi is allowlisted');
  let refused = false;
  try {
    assertAllowlisted([{ name: 'pi' }], 'prod');
  } catch (err) {
    refused = /not allowlisted/.test(err instanceof Error ? err.message : '');
  }
  expect(refused, 'unknown host is refused');
  expect(new FileWorkspace('/tmp').projectRoot === '/tmp', 'local workspace still exists');
}

async function main() {
  await testJailAndEdit();
  testTerminalGate();
  console.log('smoke-m15: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
