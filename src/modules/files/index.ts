/**
 * File read/list/write with unified diff preview.
 * Path-jailed to the project root (lexical + realpath) and .gitignore-aware.
 * Writes land only after the caller passes confirmation. Secret paths
 * (.env, keys) stay closed unless that confirmation explicitly opens them.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';
import ignore from 'ignore';
import { assertInsideProject } from '../safety';

export interface DiffPreview {
  editId: string;
  filePath: string;
  original: string;
  proposed: string;
  unifiedDiff: string;
  /** True when the file did not exist at preview time. */
  created: boolean;
  /** True for .env / key material. Apply still needs allowSecret. */
  secret: boolean;
  /** True when proposed bytes already match the file. */
  unchanged: boolean;
}

export interface EditSpec {
  /** Full new file contents. Creates the file when it is missing. */
  content?: string;
  /** Exact substring to replace. Must occur once. */
  search?: string;
  replace?: string;
}

export interface UndoResult {
  filePath: string;
  action: 'restored' | 'deleted';
}

/** Cap a single read so a huge file cannot flood the agent context. */
export const MAX_READ_CHARS = 200_000;

const HARD_IGNORE = ['node_modules/', 'dist/', '.git/', '.jewbot/', '*.gguf'];

const SECRET_IGNORE = [
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
];

const ALWAYS_IGNORE = [...HARD_IGNORE, ...SECRET_IGNORE];

export class SecretPathError extends Error {
  readonly code = 'secret_path' as const;
  readonly rel: string;
  constructor(rel: string) {
    super(`Refusing to open secret path without confirmation: ${rel}`);
    this.name = 'SecretPathError';
    this.rel = rel;
  }
}

interface UndoRecord {
  filePath: string;
  previous: string | null;
  written: string;
  secret: boolean;
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

function pathIgnored(ig: ReturnType<typeof ignore>, relFromRoot: string, isDir: boolean): boolean {
  const posix = toPosix(relFromRoot).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!posix || posix === '.') return false;
  if (isDir) return ig.ignores(`${posix}/`) || ig.ignores(posix);
  return ig.ignores(posix);
}

export class FileWorkspace {
  private undo = new Map<string, UndoRecord>();

  constructor(public readonly projectRoot: string) {}

  private async loadIgnore(): Promise<ReturnType<typeof ignore>> {
    const ig = ignore().add(ALWAYS_IGNORE);
    try {
      const raw = await fs.readFile(path.join(this.projectRoot, '.gitignore'), 'utf8');
      ig.add(raw);
    } catch {
      // no .gitignore — built-in secret/vendor patterns still apply
    }
    return ig;
  }

  private async isIgnored(relFromRoot: string, isDir: boolean): Promise<boolean> {
    const ig = await this.loadIgnore();
    return pathIgnored(ig, relFromRoot, isDir);
  }

  /**
   * Resolve `rel` inside the project. Symlinks are realpath'd so a link
   * cannot point the agent at /etc or another repo.
   */
  private async classify(relFromRoot: string, isDir: boolean): Promise<'ok' | 'secret' | 'blocked'> {
    const posix = toPosix(relFromRoot).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!posix || posix === '.') return 'ok';
    if (pathIgnored(ignore().add(HARD_IGNORE), relFromRoot, isDir)) return 'blocked';
    if (!isDir && pathIgnored(ignore().add(SECRET_IGNORE), relFromRoot, false)) return 'secret';
    if (await this.isIgnored(relFromRoot, isDir)) return 'blocked';
    return 'ok';
  }

  private async resolveInside(rel: string): Promise<string> {
    if (typeof rel !== 'string' || rel.includes('\0') || /[\r\n]/.test(rel)) throw new Error('Invalid path');
    const decision = assertInsideProject(this.projectRoot, rel);
    if (!decision.ok) throw new Error(decision.reason);

    const rootReal = await fs.realpath(this.projectRoot);
    const abs = path.resolve(rootReal, rel);
    const real = await materializeInside(rootReal, abs);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error(`Path escapes project root: ${rel}`);
    }
    return real;
  }

  private async canonicalRel(abs: string): Promise<string> {
    const rootReal = await fs.realpath(this.projectRoot);
    return path.relative(rootReal, abs);
  }

  async read(rel: string, opts?: { allowSecret?: boolean }): Promise<string> {
    if (!rel || rel.trim() === '' || rel.trim() === '.') throw new Error('read_file requires a file path');
    const abs = await this.resolveInside(rel);
    const relFromRoot = await this.canonicalRel(abs);
    const display = toPosix(relFromRoot);
    const access = await this.classify(relFromRoot, false);
    if (access === 'blocked') throw new Error(`Refusing to read gitignored or secret path: ${display}`);
    if (access === 'secret' && !opts?.allowSecret) throw new SecretPathError(display);
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
    const text = await fs.readFile(abs, 'utf8');
    if (text.includes('\0')) throw new Error(`Refusing to read binary file: ${rel}`);
    if (text.length > MAX_READ_CHARS) {
      const omitted = text.length - MAX_READ_CHARS;
      return `${text.slice(0, MAX_READ_CHARS)}\n… [truncated ${omitted} chars]`;
    }
    return text;
  }

  /** Full-file preview. Does not write. */
  async proposeEdit(rel: string, proposed: string, opts?: { allowSecret?: boolean }): Promise<DiffPreview> {
    return this.previewEdit(rel, { content: proposed }, opts);
  }

  /**
   * Build a unified diff for a full-file write or a unique search/replace.
   * Does not write. Secret paths throw SecretPathError unless allowSecret is set
   * by an owner confirm (never by the model).
   */
  async previewEdit(rel: string, spec: EditSpec, opts?: { allowSecret?: boolean }): Promise<DiffPreview> {
    if (spec.content !== undefined && spec.search !== undefined) {
      throw new Error('Provide either full content or a search/replace, not both');
    }
    const abs = await this.resolveInside(rel);
    const relFromRoot = await this.canonicalRel(abs);
    const display = toPosix(relFromRoot);
    const access = await this.classify(relFromRoot, false);
    if (access === 'blocked') throw new Error(`Refusing to edit gitignored or secret path: ${display}`);
    if (access === 'secret' && !opts?.allowSecret) throw new SecretPathError(display);

    let original = '';
    let created = true;
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) throw new Error(`Not a file: ${display}`);
      created = false;
      original = await fs.readFile(abs, 'utf8');
      if (original.includes('\0')) throw new Error(`Refusing to edit binary file: ${display}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Not a file')) throw err;
      if (err instanceof Error && err.message.startsWith('Refusing to edit binary')) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
      created = true;
      original = '';
    }

    const proposed = resolveProposed(display, original, created, spec);
    const unifiedDiff = createTwoFilesPatch(display, display, original, proposed, 'current', 'proposed', { context: 3 });
    return {
      editId: `edit_${randomUUID()}`,
      filePath: display,
      original,
      proposed,
      unifiedDiff,
      created,
      secret: access === 'secret',
      unchanged: proposed === original,
    };
  }

  /**
   * Write a preview. `confirmed` must be the owner's Accept — a model flag is not enough.
   * Refuses when the file changed since the preview, the path is outside the jail,
   * or a secret is opened without allowSecret.
   */
  async applyEdit(preview: DiffPreview, confirmed: boolean, opts?: { allowSecret?: boolean }): Promise<void> {
    if (confirmed !== true) throw new Error('Apply requires confirmation');
    if (!preview || typeof preview.proposed !== 'string' || typeof preview.filePath !== 'string') {
      throw new Error('Invalid edit preview');
    }
    const abs = await this.resolveInside(preview.filePath);
    const relFromRoot = await this.canonicalRel(abs);
    const display = toPosix(relFromRoot);
    const access = await this.classify(relFromRoot, false);
    if (access === 'blocked') throw new Error(`Refusing to write gitignored or secret path: ${display}`);
    if ((access === 'secret' || preview.secret) && !opts?.allowSecret) throw new SecretPathError(display);
    if (preview.proposed.includes('\0')) throw new Error(`Refusing to write binary content: ${display}`);
    if (preview.proposed.length > MAX_READ_CHARS) {
      throw new Error(`Refusing to write file larger than ${MAX_READ_CHARS} chars`);
    }

    const current = await readExistingFile(abs, display);
    if (preview.created) {
      if (current.exists) throw new Error(`File changed since the diff preview: ${display}`);
    } else if (!current.exists || current.text !== preview.original) {
      throw new Error(`File changed since the diff preview: ${display}`);
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, preview.proposed, 'utf8');
    this.rememberUndo(preview.editId, {
      filePath: display,
      previous: preview.created ? null : preview.original,
      written: preview.proposed,
      secret: access === 'secret' || preview.secret === true,
    });
  }

  /** Restore the bytes from a confirmed apply. One shot. Owner-initiated only. */
  async undoEdit(editId: string): Promise<UndoResult> {
    if (typeof editId !== 'string' || !editId) throw new Error('Unknown edit');
    const rec = this.undo.get(editId);
    if (!rec) throw new Error('Unknown edit');
    const abs = await this.resolveInside(rec.filePath);
    const relFromRoot = await this.canonicalRel(abs);
    const display = toPosix(relFromRoot);
    const access = await this.classify(relFromRoot, false);
    if (access === 'blocked') throw new Error(`Refusing to write gitignored or secret path: ${display}`);
    if (access === 'secret' && !rec.secret) throw new SecretPathError(display);

    const current = await readExistingFile(abs, display);
    if (!current.exists || current.text !== rec.written) {
      throw new Error(`File changed since the edit was applied: ${display}`);
    }
    if (rec.previous === null) {
      await fs.unlink(abs);
      this.undo.delete(editId);
      return { filePath: display, action: 'deleted' };
    }
    await fs.writeFile(abs, rec.previous, 'utf8');
    this.undo.delete(editId);
    return { filePath: display, action: 'restored' };
  }

  private rememberUndo(editId: string | undefined, rec: UndoRecord): void {
    if (!editId) return;
    this.undo.set(editId, rec);
    while (this.undo.size > 40) {
      const oldest = this.undo.keys().next().value;
      if (!oldest) break;
      this.undo.delete(oldest);
    }
  }

  async listDir(rel = '.'): Promise<string[]> {
    const abs = await this.resolveInside(rel || '.');
    const relFromRoot = await this.canonicalRel(abs);
    if (await this.isIgnored(relFromRoot, true)) {
      throw new Error(`Refusing to list gitignored path: ${toPosix(relFromRoot)}`);
    }
    const st = await fs.stat(abs);
    if (!st.isDirectory()) throw new Error(`Not a directory: ${rel}`);

    const ig = await this.loadIgnore();
    const parent = toPosix(relFromRoot);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const names: string[] = [];
    for (const ent of entries) {
      const child = parent ? `${parent}/${ent.name}` : ent.name;
      if (pathIgnored(ig, child, ent.isDirectory())) continue;
      names.push(ent.isDirectory() ? `${ent.name}/` : ent.name);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }
}

function resolveProposed(display: string, original: string, created: boolean, spec: EditSpec): string {
  let proposed: string;
  if (spec.search !== undefined) {
    if (created) throw new Error(`Cannot search/replace a file that does not exist: ${display}`);
    if (spec.replace === undefined) throw new Error('replace text is required when search is set');
    proposed = replaceOnce(original, spec.search, spec.replace);
  } else if (typeof spec.content === 'string') {
    proposed = spec.content;
  } else {
    throw new Error('Edit needs content or search text');
  }
  if (proposed.includes('\0')) throw new Error(`Refusing to write binary content: ${display}`);
  if (proposed.length > MAX_READ_CHARS) {
    throw new Error(`Refusing to write file larger than ${MAX_READ_CHARS} chars`);
  }
  return proposed;
}

function replaceOnce(original: string, search: string, replace: string): string {
  if (!search) throw new Error('search text is empty');
  if (search.length > MAX_READ_CHARS) throw new Error('search text is too long');
  const first = original.indexOf(search);
  if (first < 0) throw new Error('search text not found');
  const second = original.indexOf(search, first + search.length);
  if (second >= 0) throw new Error('search text is not unique');
  return original.slice(0, first) + replace + original.slice(first + search.length);
}

async function readExistingFile(abs: string, display: string): Promise<{ exists: boolean; text: string }> {
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new Error(`Not a file: ${display}`);
    const text = await fs.readFile(abs, 'utf8');
    if (text.includes('\0')) throw new Error(`Refusing to edit binary file: ${display}`);
    return { exists: true, text };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.startsWith('Not a file') || err.message.startsWith('Refusing to edit binary'))
    ) {
      throw err;
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { exists: false, text: '' };
    throw err;
  }
}

/**
 * realpath the deepest existing ancestor and rejoin the not-yet-created suffix.
 * Existing symlinks are resolved, so the returned path is the real location.
 */
async function materializeInside(rootReal: string, abs: string): Promise<string> {
  if (abs === rootReal) return rootReal;
  const rootPrefix = rootReal + path.sep;
  if (abs !== rootReal && !abs.startsWith(rootPrefix)) {
    throw new Error(`Path escapes project root: ${abs}`);
  }

  const missing: string[] = [];
  let probe = abs;
  while (probe !== rootReal && probe.startsWith(rootPrefix)) {
    try {
      const real = await fs.realpath(probe);
      const suffix = missing.reverse();
      return suffix.reduce((acc, part) => path.join(acc, part), real);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
      missing.push(path.basename(probe));
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  if (probe === rootReal) {
    return missing.reverse().reduce((acc, part) => path.join(acc, part), rootReal);
  }
  throw new Error(`Path escapes project root: ${abs}`);
}
