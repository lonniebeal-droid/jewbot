/**
 * A folder on an allowlisted SSH host, reached over SFTP.
 * Paths stay under the opened root. Writes still go through a diff and Accept.
 * The terminal command is only a `cd` prefix; ssh exec keeps the destructive grant.
 */

import { createTwoFilesPatch } from 'diff';
import type { DiffPreview } from '../files';
import { assertReadback, assertWithinLimit, MAX_READ_CHARS } from '../files';
import { checkShellCommand } from '../safety';

export interface SftpDirEntry {
  filename: string;
  isDirectory: boolean;
  size: number;
}

export interface SftpLike {
  readdir(abs: string): Promise<SftpDirEntry[]>;
  readFile(abs: string): Promise<Buffer>;
  writeFile(abs: string, data: Buffer): Promise<void>;
  stat(abs: string): Promise<{ isDirectory: boolean; size: number } | null>;
}

const SKIP = new Set(['node_modules', '.git', 'dist', '.jewbot']);

export class RemoteWorkspace {
  constructor(
    readonly host: string,
    readonly root: string,
    private readonly sftp: SftpLike,
  ) {
    if (!root.startsWith('/')) throw new Error('Remote root must be an absolute path.');
  }

  resolve(rel = '.'): string {
    const cleaned = rel.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (cleaned.includes('\0') || cleaned.split('/').includes('..')) {
      throw new Error(`Path escapes remote root: ${rel}`);
    }
    const base = this.root.replace(/\/+$/, '') || '/';
    if (!cleaned || cleaned === '.') return base;
    const full = `${base}/${cleaned.replace(/^\/+/, '')}`;
    if (full !== base && !full.startsWith(`${base}/`)) throw new Error(`Path escapes remote root: ${rel}`);
    return full;
  }

  async listDir(rel = '.'): Promise<string[]> {
    const abs = this.resolve(rel);
    const entries = await this.sftp.readdir(abs);
    return entries
      .filter((entry) => !SKIP.has(entry.filename) && !entry.filename.startsWith('.env'))
      .map((entry) => (entry.isDirectory ? `${entry.filename}/` : entry.filename))
      .sort();
  }

  async read(rel: string): Promise<string> {
    const abs = this.resolve(rel);
    const buf = await this.sftp.readFile(abs);
    if (buf.includes(0)) throw new Error(`Refusing to read binary file: ${rel}`);
    const text = buf.toString('utf8');
    assertWithinLimit(text, `remote read of ${rel}`);
    return text;
  }

  async proposeEdit(rel: string, proposed: string): Promise<DiffPreview> {
    let original = '';
    let created = true;
    try {
      original = await this.read(rel);
      created = false;
    } catch (err) {
      const missing = err instanceof Error && /no such file/i.test(err.message);
      if (!missing) throw err;
    }
    const display = rel.replace(/\\/g, '/');
    return {
      editId: `remote_${display}`,
      filePath: display,
      original,
      proposed,
      unifiedDiff: createTwoFilesPatch(display, display, original, proposed, 'current', 'proposed', { context: 2 }),
      created,
      secret: false,
      unchanged: original === proposed,
    };
  }

  async applyEdit(preview: DiffPreview, confirmed: boolean, _opts?: { allowSecret?: boolean }): Promise<void> {
    if (confirmed !== true) throw new Error('Apply requires confirmation');
    if (preview.proposed.length > MAX_READ_CHARS) {
      throw new Error(`Refusing to write remote file larger than ${MAX_READ_CHARS} chars`);
    }
    const abs = this.resolve(preview.filePath);
    const body = Buffer.from(preview.proposed, 'utf8');
    await this.sftp.writeFile(abs, body);
    const readback = await this.sftp.readFile(abs);
    assertReadback(preview.filePath, preview.proposed, readback.toString('utf8'));
  }

  /** Walk text files for a remote project search. Skips vendor and VCS dirs. */
  async search(query: string): Promise<Array<{ path: string; line: number; text: string }>> {
    const hits: Array<{ path: string; line: number; text: string }> = [];
    const needle = query.toLowerCase();
    const walk = async (rel: string): Promise<void> => {
      const entries = await this.listDir(rel);
      for (const name of entries) {
        const child = rel === '.' ? name.replace(/\/$/, '') : `${rel}/${name.replace(/\/$/, '')}`;
        if (name.endsWith('/')) {
          await walk(child);
          continue;
        }
        const text = await this.read(child);
        text.split('\n').forEach((line, index) => {
          if (line.toLowerCase().includes(needle)) hits.push({ path: child, line: index + 1, text: line });
        });
      }
    };
    await walk('.');
    return hits;
  }
}

/** Prefix a remote shell command. The caller still runs it through ssh exec. */
export function remoteCommand(root: string, command: string): string {
  if (!root.startsWith('/')) throw new Error('Remote root must be an absolute path.');
  const quoted = `'${root.replace(/'/g, `'\\''`)}'`;
  return `cd ${quoted} && ${command}`;
}

export function remoteCommandGate(root: string, command: string): { command: string; ok: boolean; needsConfirmation: boolean; reason?: string } {
  const wrapped = remoteCommand(root, command);
  const decision = checkShellCommand(wrapped);
  return {
    command: wrapped,
    ok: decision.ok,
    needsConfirmation: decision.ok ? false : decision.needsConfirmation,
    reason: decision.ok ? undefined : decision.reason,
  };
}
