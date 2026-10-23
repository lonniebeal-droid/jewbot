/**
 * Project-aware context indexer.
 * Walks the opened project, honors .gitignore plus default ignores, and
 * returns a compact tree and small excerpts. Never reads outside the
 * project root. Secrets and binaries are skipped by default.
 */

import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import { assertInsideProject } from '../safety';

export interface ContextSummary {
  /** Real path of the project jail. */
  root: string;
  /** Relative paths, capped by the summarize() limit. Not a full dump when truncated. */
  files: string[];
  /** True when `files` is shorter than the walk, or the walk hit the index cap. */
  truncated: boolean;
  /** True only when the walk stopped at the index cap. */
  indexTruncated: boolean;
  fileCount: number;
  dirCount: number;
  tree: string;
  topLevel: string[];
  languages: Array<{ ext: string; count: number }>;
}

export interface ContextSearchHit {
  path: string;
  line: number;
  text: string;
  excerpt: string;
}

export interface ContextSearchResult {
  query: string;
  hits: ContextSearchHit[];
  truncated: boolean;
  filesScanned: number;
  indexTruncated: boolean;
  error?: string;
}

export interface FindFilesResult {
  query: string;
  matches: string[];
  truncated: boolean;
  indexTruncated: boolean;
  error?: string;
}

interface ProjectIndex {
  root: string;
  files: string[];
  dirCount: number;
  truncated: boolean;
}

interface IgnoreFrame {
  /** Posix directory this .gitignore applies to. '' is the project root. */
  dir: string;
  ig: Ignore;
}

interface TreeNode {
  dirs: Map<string, TreeNode>;
  files: string[];
}

const INDEX_CAP = 8000;
const TREE_MAX_LINES = 80;
const TREE_MAX_CHARS = 4500;
const PROMPT_MAX_CHARS = 9000;
const EXCERPT_MAX_CHARS = 3200;
const EXCERPT_MAX_BLOCKS = 5;
const SEARCH_READ_MAX = 256_000;
const SEARCH_SCAN_CAP = 500;
const FIND_LIMIT_DEFAULT = 50;
const FIND_LIMIT_MAX = 200;
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 40;
const LINE_MAX = 200;

/** Directories and binary types that stay out of the index even if .gitignore negates them. */
const HARD_PATTERNS = [
  'node_modules/',
  'dist/',
  'out/',
  'release/',
  '.git/',
  '.jewbot/',
  '.electron/',
  'coverage/',
  '.nyc_output/',
  '.next/',
  '.nuxt/',
  '.cache/',
  '.turbo/',
  '.parcel-cache/',
  '*.gguf',
  '*.bin',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.o',
  '*.a',
  '*.obj',
  '*.lib',
  '*.class',
  '*.pyc',
  '*.pyo',
  '*.wasm',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.webp',
  '*.ico',
  '*.icns',
  '*.pdf',
  '*.zip',
  '*.gz',
  '*.tgz',
  '*.tar',
  '*.bz2',
  '*.xz',
  '*.7z',
  '*.rar',
  '*.mp3',
  '*.mp4',
  '*.wav',
  '*.ogg',
  '*.webm',
  '*.mov',
  '*.avi',
  '*.flac',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.otf',
  '*.eot',
  '*.sqlite',
  '*.db',
  '*.parquet',
  '*.lockb',
  '*.jar',
  '*.war',
  '*.dmg',
  '*.iso',
];

/**
 * Secret names are never indexed and never returned from search.
 * `!.env.example` keeps the sample env file visible.
 */
const SECRET_PATTERNS = [
  '.env',
  '.env.*',
  '!.env.example',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.kdbx',
  '*.keystore',
  '*.jks',
  '*.secret',
  'id_rsa',
  'id_rsa.pub',
  'id_dsa',
  'id_dsa.pub',
  'id_ecdsa',
  'id_ecdsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  'credentials.json',
  'secrets.json',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'secrets/',
  '.aws/credentials',
  '**/.aws/credentials',
];

const STOP_TOKENS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'file',
  'files',
  'code',
  'about',
  'what',
  'where',
  'when',
  'how',
  'does',
  'have',
  'please',
  'show',
  'read',
  'list',
  'project',
  'using',
  'use',
  'your',
  'you',
  'are',
  'was',
  'were',
  'will',
  'just',
  'only',
  'than',
  'then',
  'them',
  'they',
  'their',
  'there',
  'here',
  'which',
  'while',
  'whose',
  'would',
  'could',
  'should',
  'tell',
  'make',
  'want',
  'need',
  'help',
  'like',
  'also',
  'more',
  'some',
  'any',
  'not',
  'but',
  'can',
  'all',
  'its',
  'our',
  'out',
  'get',
  'see',
  'look',
  'find',
  'search',
  'context',
  'agent',
  'function',
  'return',
  'const',
  'class',
  'export',
  'import',
  'async',
  'await',
  'true',
  'false',
  'null',
  'undefined',
  'default',
  'public',
  'private',
  'interface',
  'type',
  'string',
  'number',
  'static',
  'void',
]);

const hardFilter = ignore().add(HARD_PATTERNS);
const secretFilter = ignore().add(SECRET_PATTERNS);

function toPosix(rel: string): string {
  return rel.split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isInsideRoot(rootReal: string, candidate: string): boolean {
  const rel = path.relative(rootReal, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function ignoredBy(ig: Ignore, relPosix: string, isDir: boolean): boolean {
  const posix = toPosix(relPosix);
  if (!posix || posix === '.') return false;
  if (!isDir) return ig.ignores(posix);
  // Trailing slash is the directory check. A negated `!src/` un-ignores the
  // directory even when a broader `*` ignores the bare name `src`.
  return ig.ignores(`${posix}/`);
}

function localPath(frameDir: string, rel: string): string | null {
  if (!frameDir) return rel;
  if (rel === frameDir) return null;
  const prefix = `${frameDir}/`;
  if (!rel.startsWith(prefix)) return null;
  return rel.slice(prefix.length);
}

function ignoredByFrames(frames: IgnoreFrame[], rel: string, isDir: boolean): boolean {
  for (const frame of frames) {
    const local = localPath(frame.dir, rel);
    if (local == null || local === '') continue;
    if (ignoredBy(frame.ig, local, isDir)) return true;
  }
  return false;
}

function isSecretPath(rel: string, isDir: boolean): boolean {
  return ignoredBy(secretFilter, rel, isDir);
}

function isHardPath(rel: string, isDir: boolean): boolean {
  return ignoredBy(hardFilter, rel, isDir);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

function clipLine(text: string): string {
  if (text.length <= LINE_MAX) return text;
  return `${text.slice(0, LINE_MAX)}…`;
}

function numberedExcerpt(lines: string[], start: number, end: number, focus: number): string {
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    const mark = i === focus ? '>' : ' ';
    out.push(`${mark} ${i + 1}| ${clipLine(lines[i] ?? '')}`);
  }
  return out.join('\n');
}

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
          continue;
        }
        out += '.*';
        i += 1;
        continue;
      }
      out += '[^/]*';
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    if ('.+^${}()|[]\\'.includes(c)) out += `\\${c}`;
    else out += c;
  }
  return new RegExp(`^${out}$`);
}

function pathMatches(query: string, rel: string): boolean {
  let q = query.trim().replace(/\\/g, '/');
  if (q.startsWith('./')) q = q.slice(2);
  if (!q || q === '.' || q === '..') return false;
  if (q.split('/').some((seg) => seg === '..')) return false;
  if (q.includes('*') || q.includes('?')) {
    if (!q.includes('/')) {
      const base = rel.split('/').pop() ?? rel;
      if (globToRegExp(q).test(base)) return true;
      return globToRegExp(`**/${q}`).test(rel);
    }
    return globToRegExp(q).test(rel);
  }
  const needle = q.toLowerCase();
  return rel.toLowerCase().includes(needle);
}

function renderTree(files: string[]): string {
  const root: TreeNode = { dirs: new Map(), files: [] };
  for (const rel of files) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let child = node.dirs.get(name);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.files.push(parts[parts.length - 1] ?? rel);
  }

  const lines: string[] = [];
  const walk = (node: TreeNode, prefix: string) => {
    if (lines.length >= TREE_MAX_LINES) return;
    const entries: Array<{ name: string; dir: boolean }> = [
      ...[...node.dirs.keys()].sort().map((name) => ({ name, dir: true })),
      ...[...node.files].sort().map((name) => ({ name, dir: false })),
    ];
    const shown = entries.slice(0, 24);
    const hidden = entries.length - shown.length;
    for (const ent of shown) {
      if (lines.length >= TREE_MAX_LINES) {
        lines.push(`${prefix}…`);
        return;
      }
      if (ent.dir) {
        lines.push(`${prefix}${ent.name}/`);
        const child = node.dirs.get(ent.name);
        if (child) walk(child, `${prefix}  `);
      } else {
        lines.push(`${prefix}${ent.name}`);
      }
    }
    if (hidden > 0 && lines.length < TREE_MAX_LINES) lines.push(`${prefix}… (${hidden} more)`);
  };
  walk(root, '');
  let text = lines.join('\n');
  if (text.length > TREE_MAX_CHARS) text = `${text.slice(0, TREE_MAX_CHARS)}\n… (tree truncated)`;
  return text;
}

function topLevelOf(files: string[]): string[] {
  const set = new Set<string>();
  for (const rel of files) {
    const slash = rel.indexOf('/');
    set.add(slash === -1 ? rel : `${rel.slice(0, slash)}/`);
  }
  return [...set].sort();
}

function languagesOf(files: string[]): Array<{ ext: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rel of files) {
    const base = rel.split('/').pop() ?? rel;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : '(none)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
}

function extractTokens(goal: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const token = raw.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/^\.\//, '');
    if (token.length < 3 || token.length > 160) return;
    if (token.split('/').some((seg) => seg === '..')) return;
    const key = token.toLowerCase();
    if (STOP_TOKENS.has(key) || seen.has(key)) return;
    if (!/[a-z0-9]/i.test(token)) return;
    seen.add(key);
    found.push(token);
  };
  const pathRe = /(?:^|[\s'"`])((?:[\w.@+-]+\/)+[\w.@+-]+)/g;
  const fileRe = /\b[\w.@+-]+\.[A-Za-z0-9]{1,8}\b/g;
  const identRe = /\b[A-Za-z_][\w$]{3,}\b/g;
  for (const re of [pathRe, fileRe, identRe]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(goal))) push(match[1] ?? match[0]);
  }
  return found.slice(0, 6);
}

async function readGitignore(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

export class ContextIndexer {
  constructor(public readonly projectRoot: string) {}

  /** Compact summary. `files` is capped; the tree is built from the full walk. */
  async summarize(maxFiles = 400): Promise<ContextSummary> {
    const index = await this.buildIndex();
    return this.toSummary(index, maxFiles);
  }

  async getProjectSummary(maxFiles = 400): Promise<ContextSummary> {
    return this.summarize(maxFiles);
  }

  /**
   * Path substring or glob (`*.ts`, `src/**\/*.ts`). Matches indexed files only.
   * Patterns that climb out of the project match nothing.
   */
  async findFiles(query: string, opts?: { limit?: number }): Promise<FindFilesResult> {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return { query: q, matches: [], truncated: false, indexTruncated: false, error: 'find_files requires a query' };
    if (q.length > 300) return { query: q.slice(0, 300), matches: [], truncated: false, indexTruncated: false, error: 'Query is too long' };
    if (q.includes('\0')) return { query: '', matches: [], truncated: false, indexTruncated: false, error: 'Invalid query' };
    const index = await this.buildIndex();
    const limit = clampLimit(opts?.limit, FIND_LIMIT_DEFAULT, FIND_LIMIT_MAX);
    const matches: string[] = [];
    for (const file of index.files) {
      if (!pathMatches(q, file)) continue;
      matches.push(file);
      if (matches.length > limit) break;
    }
    return {
      query: q,
      matches: matches.slice(0, limit),
      truncated: matches.length > limit,
      indexTruncated: index.truncated,
    };
  }

  /**
   * Case-insensitive text search over indexed files. `path` limits the search
   * to one indexed file or directory. Secret and ignored paths are refused
   * without being read. Targets outside the project throw.
   */
  async searchContext(query: string, opts?: { path?: string; limit?: number }): Promise<ContextSearchResult> {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) {
      return { query: '', hits: [], truncated: false, filesScanned: 0, indexTruncated: false, error: 'search_context requires a query' };
    }
    if (q.length > 200) {
      return { query: q.slice(0, 200), hits: [], truncated: false, filesScanned: 0, indexTruncated: false, error: 'Query is too long' };
    }
    if (q.includes('\0')) {
      return { query: '', hits: [], truncated: false, filesScanned: 0, indexTruncated: false, error: 'Invalid query' };
    }

    const index = await this.buildIndex();
    const candidates = await this.candidatesFor(index, opts?.path);
    const limit = clampLimit(opts?.limit, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
    const found = await this.searchIndexed(index, q, candidates, limit);
    return { query: q, indexTruncated: index.truncated, ...found };
  }

  /** Compact tree plus a few excerpts chosen from the goal. Capped. Never the whole repo. */
  async buildTurnContext(goal: string): Promise<string> {
    const index = await this.buildIndex();
    const summary = this.toSummary(index, 400);
    const excerpts = await this.excerptsFor(index, goal);
    let text = this.formatForPrompt(summary);
    if (excerpts) text = `${text}\n\n${excerpts}`;
    if (text.length <= PROMPT_MAX_CHARS) return text;
    return `${text.slice(0, PROMPT_MAX_CHARS)}\n… (context truncated)`;
  }

  formatForPrompt(summary: ContextSummary): string {
    const langs = summary.languages
      .slice(0, 8)
      .map((item) => `${item.ext} ${item.count}`)
      .join(', ');
    const top = summary.topLevel.slice(0, 40).join(', ');
    const lines = [
      `Project root: ${summary.root}`,
      `Indexed ${summary.fileCount} files in ${summary.dirCount} directories${summary.indexTruncated ? ' (walk stopped at the file cap)' : ''}.`,
      'Omitted: secrets (.env, keys, credentials), binaries, and paths ignored by .gitignore or defaults (node_modules, .git, dist, build caches).',
      'Compact tree only — not the whole repo. Use get_project_summary, find_files, or search_context to look further.',
    ];
    if (langs) lines.push(`Extensions: ${langs}`);
    if (top) lines.push(`Top-level: ${top}`);
    lines.push('', summary.tree || '(no files indexed)');
    return lines.join('\n');
  }

  private toSummary(index: ProjectIndex, maxFiles: number): ContextSummary {
    const cap = Math.max(1, Math.floor(maxFiles));
    return {
      root: index.root,
      files: index.files.slice(0, cap),
      truncated: index.truncated || index.files.length > cap,
      indexTruncated: index.truncated,
      fileCount: index.files.length,
      dirCount: index.dirCount,
      tree: renderTree(index.files),
      topLevel: topLevelOf(index.files),
      languages: languagesOf(index.files),
    };
  }

  private async buildIndex(): Promise<ProjectIndex> {
    const root = await this.resolveRoot();
    const files: string[] = [];
    let dirCount = 0;
    let truncated = false;
    const frames: IgnoreFrame[] = [];
    const rootIgnore = await readGitignore(path.join(root, '.gitignore'));
    if (rootIgnore != null) frames.push({ dir: '', ig: ignore().add(rootIgnore) });

    const walk = async (dirAbs: string, dirRel: string, active: IgnoreFrame[]) => {
      if (files.length >= INDEX_CAP) {
        truncated = true;
        return;
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      let nextFrames = active;
      if (dirRel) {
        const nested = await readGitignore(path.join(dirAbs, '.gitignore'));
        if (nested != null) nextFrames = [...active, { dir: dirRel, ig: ignore().add(nested) }];
      }

      for (const ent of entries) {
        if (files.length >= INDEX_CAP) {
          truncated = true;
          return;
        }
        if (!ent.name || ent.name === '.' || ent.name === '..') continue;
        if (ent.name.includes('\0') || /[\r\n]/.test(ent.name)) continue;
        const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
        if (rel.length > 1024) continue;
        const abs = path.join(dirAbs, ent.name);

        if (ent.isSymbolicLink()) {
          const target = await this.symlinkInside(root, abs);
          if (!target || target.isDir) continue;
          if (isSecretPath(rel, false) || isHardPath(rel, false) || ignoredByFrames(nextFrames, rel, false)) continue;
          files.push(rel);
          continue;
        }

        if (ent.isDirectory()) {
          if (isSecretPath(rel, true) || isHardPath(rel, true) || ignoredByFrames(nextFrames, rel, true)) continue;
          let real: string;
          try {
            real = await fs.realpath(abs);
          } catch {
            continue;
          }
          if (!isInsideRoot(root, real)) continue;
          dirCount += 1;
          await walk(real, rel, nextFrames);
          continue;
        }

        if (!ent.isFile()) continue;
        if (isSecretPath(rel, false) || isHardPath(rel, false) || ignoredByFrames(nextFrames, rel, false)) continue;
        files.push(rel);
      }
    };

    await walk(root, '', frames);
    files.sort((a, b) => a.localeCompare(b));
    return { root, files, dirCount, truncated };
  }

  private async resolveRoot(): Promise<string> {
    const abs = path.resolve(this.projectRoot);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(abs);
    } catch {
      throw new Error(`Project root is not a directory: ${abs}`);
    }
    if (!st.isDirectory()) throw new Error(`Project root is not a directory: ${abs}`);
    return fs.realpath(abs);
  }

  private async symlinkInside(root: string, abs: string): Promise<{ real: string; isDir: boolean } | null> {
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      return null;
    }
    if (!isInsideRoot(root, real)) return null;
    try {
      const st = await fs.stat(real);
      if (!st.isFile() && !st.isDirectory()) return null;
      return { real, isDir: st.isDirectory() };
    } catch {
      return null;
    }
  }

  /** Null means the path is the project root itself. Throws when the path leaves the jail. */
  private normalizeRel(root: string, rel: string): string | null {
    if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0') || /[\r\n]/.test(rel)) {
      throw new Error('Invalid path');
    }
    const decision = assertInsideProject(root, rel);
    if (!decision.ok) throw new Error(decision.reason);
    const abs = path.resolve(root, rel);
    const relative = path.relative(root, abs);
    if (relative === '') return null;
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path escapes project root: ${rel}`);
    }
    return toPosix(relative);
  }

  private async gitIgnored(root: string, rel: string): Promise<boolean> {
    const frames: IgnoreFrame[] = [];
    const rootIgnore = await readGitignore(path.join(root, '.gitignore'));
    if (rootIgnore != null) frames.push({ dir: '', ig: ignore().add(rootIgnore) });
    const parts = rel.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      const nested = await readGitignore(path.join(root, acc, '.gitignore'));
      if (nested != null) frames.push({ dir: acc, ig: ignore().add(nested) });
    }
    return ignoredByFrames(frames, rel, false) || ignoredByFrames(frames, rel, true);
  }

  /** Read an indexed text file. Returns null for binary, oversized, or escaped paths. */
  private async readIndexedText(root: string, rel: string, maxBytes: number): Promise<string | null> {
    if (isSecretPath(rel, false) || isHardPath(rel, false)) return null;
    const abs = path.resolve(root, rel);
    if (!isInsideRoot(root, abs)) return null;
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      return null;
    }
    if (!isInsideRoot(root, real)) return null;
    try {
      const st = await fs.stat(real);
      if (!st.isFile() || st.size > maxBytes) return null;
      const buf = await fs.readFile(real);
      if (buf.includes(0)) return null;
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }

  private async candidatesFor(index: ProjectIndex, pathFilter: string | undefined): Promise<string[]> {
    if (pathFilter === undefined) return index.files;
    const raw = pathFilter.trim();
    if (!raw || raw === '.' || raw === './') return index.files;
    const rel = this.normalizeRel(index.root, raw);
    if (rel == null) return index.files;
    if (isSecretPath(rel, false) || isSecretPath(rel, true)) {
      throw new Error(`Refusing to search secret path: ${rel}`);
    }
    if (isHardPath(rel, false) || isHardPath(rel, true) || (await this.gitIgnored(index.root, rel))) {
      throw new Error(`Refusing to search ignored path: ${rel}`);
    }
    return index.files.filter((file) => file === rel || file.startsWith(`${rel}/`));
  }

  private async searchIndexed(
    index: ProjectIndex,
    query: string,
    candidates: string[],
    limit: number,
  ): Promise<{ hits: ContextSearchHit[]; truncated: boolean; filesScanned: number }> {
    const needle = query.toLowerCase();
    const hits: ContextSearchHit[] = [];
    let filesScanned = 0;
    let truncated = false;
    for (const file of candidates) {
      if (filesScanned >= SEARCH_SCAN_CAP) {
        truncated = true;
        break;
      }
      const text = await this.readIndexedText(index.root, file, SEARCH_READ_MAX);
      if (text == null) continue;
      filesScanned += 1;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 3);
        hits.push({
          path: file,
          line: i + 1,
          text: clipLine(lines[i].trim()),
          excerpt: numberedExcerpt(lines, start, end, i),
        });
        if (hits.length > limit) {
          truncated = true;
          break;
        }
      }
      if (hits.length > limit) break;
    }
    return { hits: hits.slice(0, limit), truncated, filesScanned };
  }

  private async excerptsFor(index: ProjectIndex, goal: string): Promise<string> {
    const tokens = extractTokens(goal);
    if (!tokens.length) return '';
    const blocks: string[] = [];
    let budget = EXCERPT_MAX_CHARS;
    const seen = new Set<string>();

    const pushBlock = (block: string) => {
      if (budget <= 0 || blocks.length >= EXCERPT_MAX_BLOCKS) return;
      const clipped = block.length > budget ? `${block.slice(0, budget)}\n…` : block;
      blocks.push(clipped);
      budget -= clipped.length;
    };

    for (const token of tokens) {
      if (budget <= 0 || blocks.length >= EXCERPT_MAX_BLOCKS) break;
      if (index.files.includes(token)) {
        const text = await this.readIndexedText(index.root, token, 16_000);
        if (text != null) {
          const lines = text.split(/\r?\n/);
          const end = Math.min(lines.length, 24);
          const key = `${token}:head`;
          if (!seen.has(key)) {
            seen.add(key);
            for (let i = 0; i < end; i++) seen.add(`${token}:${i + 1}`);
            pushBlock(`${token}:1\n${numberedExcerpt(lines, 0, end, -1)}`);
          }
        }
      }
      const found = await this.searchIndexed(index, token, index.files, 2);
      for (const hit of found.hits) {
        if (seen.has(`${hit.path}:${hit.line}`)) continue;
        seen.add(`${hit.path}:${hit.line}`);
        pushBlock(`${hit.path}:${hit.line}\n${hit.excerpt}`);
        if (budget <= 0 || blocks.length >= EXCERPT_MAX_BLOCKS) break;
      }
    }

    if (!blocks.length) return '';
    return `Relevant excerpts (a few matches for this turn, not the whole repo):\n\n${blocks.join('\n\n')}`;
  }
}

export function formatSearchResult(result: ContextSearchResult): string {
  if (result.error) return `ERROR: ${result.error}`;
  const prefix = result.indexTruncated ? 'Project index is truncated. ' : '';
  if (!result.hits.length) return `${prefix}No matches for ${JSON.stringify(result.query)}.`;
  const body = result.hits.map((hit) => `${hit.path}:${hit.line}: ${hit.text}\n${hit.excerpt}`).join('\n\n');
  const more = result.truncated ? '\n… (more matches omitted)' : '';
  return `${prefix}${body}${more}`;
}

export function formatFindResult(result: FindFilesResult): string {
  if (result.error) return `ERROR: ${result.error}`;
  const prefix = result.indexTruncated ? 'Project index is truncated.\n' : '';
  if (!result.matches.length) return `${prefix}No files matched ${JSON.stringify(result.query)}.`;
  const more = result.truncated ? '\n… (more matches omitted)' : '';
  return `${prefix}${result.matches.join('\n')}${more}`;
}
