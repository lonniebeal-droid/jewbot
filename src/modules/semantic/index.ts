/**
 * M11 semantic index. Vectors live in .jewbot/index/vectors.json.
 * The walk uses the same ignore idea as M4: .gitignore plus node_modules,
 * dist, .git, and .jewbot. No SQLite. No paid embed API.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import type { JewbotModule } from '../plugin/types';
import { assertInsideProject } from '../safety';
import { inspectOllamaHosts } from '../llm/route';
import type { OllamaHostEntry } from '../llm/hosts';
import { cosine, embedTexts, EMBED_MODEL } from './embed';

export { EMBED_MODEL, cosine, embedTexts } from './embed';

const SKIP = ['node_modules/', 'dist/', '.git/', '.jewbot/', '*.gguf', '.env', '.env.*', '!.env.example', '*.pem', '*.key'];

export interface VectorRow {
  path: string;
  mtimeMs: number;
  size: number;
  vector: number[];
}

export interface VectorFile {
  version: 1;
  model: string;
  files: VectorRow[];
}

export interface Mention {
  kind: 'file' | 'folder' | 'codebase';
  value: string;
}

export function indexPath(root: string): string {
  return path.join(root, '.jewbot', 'index', 'vectors.json');
}

export async function reindex(root: string, options?: { host?: string; entries?: OllamaHostEntry[]; signal?: AbortSignal }): Promise<{ updated: string[]; skipped: string[] }> {
  const project = await realRoot(root);
  const files = await walk(project);
  const previous = await readStore(project);
  const kept = new Map(previous.files.map((row) => [row.path, row]));
  const updated: string[] = [];
  const skipped: string[] = [];
  const pending: Array<{ path: string; mtimeMs: number; size: number; text: string }> = [];
  const rows: VectorRow[] = [];
  for (const file of files) {
    const prior = kept.get(file.path);
    if (prior && prior.mtimeMs === file.mtimeMs && prior.size === file.size) {
      rows.push(prior);
      skipped.push(file.path);
      continue;
    }
    pending.push(file);
  }
  if (pending.length) {
    const host = options?.host || (await healthyHost(options?.entries));
    const vectors = await embedTexts({ host, input: pending.map((file) => file.text.slice(0, 2000)), model: EMBED_MODEL, signal: options?.signal });
    pending.forEach((file, index) => {
      rows.push({ path: file.path, mtimeMs: file.mtimeMs, size: file.size, vector: vectors[index] });
      updated.push(file.path);
    });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  await writeStore(project, { version: 1, model: EMBED_MODEL, files: rows });
  return { updated, skipped };
}

export async function semanticSearch(root: string, query: string, k = 5, options?: { host?: string; entries?: OllamaHostEntry[] }): Promise<Array<{ path: string; score: number }>> {
  const project = await realRoot(root);
  const store = await readStore(project);
  if (!store.files.length) return [];
  const host = options?.host || (await healthyHost(options?.entries));
  const [vector] = await embedTexts({ host, input: [query], model: EMBED_MODEL });
  return store.files
    .map((row) => ({ path: row.path, score: cosine(vector, row.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function formatSemanticSearch(hits: Array<{ path: string; score: number }>): string {
  if (!hits.length) return 'semantic_search: no hits';
  return hits.map((hit) => `${hit.path} score=${hit.score.toFixed(3)}`).join('\n');
}

const MENTION = /@(file|folder|codebase)\s+(\S+)/g;

export function parseMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  for (const match of text.matchAll(MENTION)) {
    const kind = match[1] as Mention['kind'];
    mentions.push({ kind, value: match[2] });
  }
  return mentions;
}

export async function expandMentions(root: string, text: string, options?: { host?: string }): Promise<string> {
  const mentions = parseMentions(text);
  if (!mentions.length) return text;
  const parts = [text];
  for (const mention of mentions) {
    if (mention.kind === 'file') {
      const body = await readRel(root, mention.value);
      parts.push(`\n@file ${mention.value}\n${body.slice(0, 2000)}`);
    } else if (mention.kind === 'folder') {
      const names = await listRel(root, mention.value);
      parts.push(`\n@folder ${mention.value}\n${names.join('\n')}`);
    } else {
      const hits = await semanticSearch(root, mention.value, 5, options);
      parts.push(`\n@codebase ${mention.value}\n${formatSemanticSearch(hits)}`);
    }
  }
  return parts.join('\n');
}

export const jewbotModule: JewbotModule = {
  id: 'semantic',
  title: 'Semantic index',
  description: 'Local nomic-embed-text vectors in .jewbot/index. semantic_search and @file @folder @codebase stay on Ollama.',
  version: '0.2.0',
  capabilities: ['search', 'local-only'],
  tools: [
    { name: 'semantic_search', description: 'Rank project files by local Ollama embeddings. Respects gitignore. Does not call a paid API.' },
  ],
  health() {
    return { ok: true, detail: `embed model ${EMBED_MODEL}` };
  },
};

async function healthyHost(entries?: OllamaHostEntry[]): Promise<string> {
  const report = await inspectOllamaHosts({ model: EMBED_MODEL, entries });
  const host = report.selected?.host || report.hosts.find((row) => row.ok)?.host;
  if (!host) throw new Error('No healthy local Ollama host for embeddings.');
  return host;
}

async function realRoot(root: string): Promise<string> {
  const abs = path.resolve(root);
  const stat = await fs.lstat(abs);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Semantic index root is not a real directory.');
  return fs.realpath(abs);
}

async function walk(root: string): Promise<Array<{ path: string; mtimeMs: number; size: number; text: string }>> {
  const ig = ignore().add(SKIP);
  try {
    ig.add(await fs.readFile(path.join(root, '.gitignore'), 'utf8'));
  } catch {
    // built-in skips still apply
  }
  const out: Array<{ path: string; mtimeMs: number; size: number; text: string }> = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ig.ignores(`${rel}/`) || ig.ignores(rel)) continue;
        await visit(abs);
        continue;
      }
      if (!entry.isFile() || ig.ignores(rel)) continue;
      const stat = await fs.stat(abs);
      if (stat.size > 200_000) continue;
      const text = await fs.readFile(abs, 'utf8');
      if (text.includes('\0')) continue;
      out.push({ path: rel, mtimeMs: stat.mtimeMs, size: stat.size, text });
    }
  }
  await visit(root);
  return out;
}

async function readStore(root: string): Promise<VectorFile> {
  try {
    const raw = await fs.readFile(indexPath(root), 'utf8');
    const parsed = JSON.parse(raw) as VectorFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) throw new Error('bad store');
    return parsed;
  } catch {
    return { version: 1, model: EMBED_MODEL, files: [] };
  }
}

async function writeStore(root: string, store: VectorFile): Promise<void> {
  const file = indexPath(root);
  const decision = assertInsideProject(root, path.relative(root, file));
  if (!decision.ok) throw new Error(decision.reason);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(store)}\n`, 'utf8');
}

async function readRel(root: string, rel: string): Promise<string> {
  const abs = path.resolve(root, rel);
  const decision = assertInsideProject(root, rel);
  if (!decision.ok) throw new Error(decision.reason);
  return fs.readFile(abs, 'utf8');
}

async function listRel(root: string, rel: string): Promise<string[]> {
  const abs = path.resolve(root, rel);
  const decision = assertInsideProject(root, rel);
  if (!decision.ok) throw new Error(decision.reason);
  const names = await fs.readdir(abs);
  return names.sort();
}
