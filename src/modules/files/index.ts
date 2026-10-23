/**
 * File read/list/write with unified diff preview.
 * Path-jailed to the project root (lexical + realpath) and .gitignore-aware.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createTwoFilesPatch } from 'diff';
import ignore from 'ignore';
import { assertInsideProject } from '../safety';

export interface DiffPreview {
  filePath: string;
  original: string;
  proposed: string;
  unifiedDiff: string;
}

/** Cap a single read so a huge file cannot flood the agent context. */
export const MAX_READ_CHARS = 200_000;

const ALWAYS_IGNORE = [
  'node_modules/',
  'dist/',
  '.git/',
  '.jewbot/',
  '*.gguf',
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
  private async resolveInside(rel: string): Promise<string> {
    if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Invalid path');
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

  async read(rel: string): Promise<string> {
    if (!rel || rel.trim() === '' || rel.trim() === '.') throw new Error('read_file requires a file path');
    const abs = await this.resolveInside(rel);
    const relFromRoot = await this.canonicalRel(abs);
    if (await this.isIgnored(relFromRoot, false)) {
      throw new Error(`Refusing to read gitignored or secret path: ${toPosix(relFromRoot)}`);
    }
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

  async proposeEdit(rel: string, proposed: string): Promise<DiffPreview> {
    const abs = await this.resolveInside(rel);
    const relFromRoot = await this.canonicalRel(abs);
    if (await this.isIgnored(relFromRoot, false)) {
      throw new Error(`Refusing to edit gitignored or secret path: ${toPosix(relFromRoot)}`);
    }
    let original = '';
    try {
      const st = await fs.stat(abs);
      if (st.isFile()) original = await fs.readFile(abs, 'utf8');
    } catch {
      original = '';
    }
    const display = toPosix(relFromRoot);
    const unifiedDiff = createTwoFilesPatch(display, display, original, proposed, 'a', 'b');
    return { filePath: display, original, proposed, unifiedDiff };
  }

  async applyEdit(preview: DiffPreview, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error('Apply requires confirmation');
    const abs = await this.resolveInside(preview.filePath);
    const relFromRoot = await this.canonicalRel(abs);
    if (await this.isIgnored(relFromRoot, false)) {
      throw new Error(`Refusing to write gitignored or secret path: ${toPosix(relFromRoot)}`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, preview.proposed, 'utf8');
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
