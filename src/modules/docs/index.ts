/**
 * M21 local docs. A chosen folder or a one-time public URL is embedded into
 * the M11 store under docs: paths. Later reads use the cache and do not fetch.
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { JewbotModule } from '../plugin/types';
import { isPaidProviderHost } from '../llm/ollama';
import { assertLocalSpendOnly, assertInsideProject } from '../safety';
import { embedTexts, mergeDocRows, type VectorRow } from '../semantic';

export interface DocsIndexResult {
  paths: string[];
  fetched: boolean;
}

const SKIP = new Set(['node_modules', '.git', 'dist', '.jewbot']);

export function assertDocUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Docs URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Docs URL must be http or https.');
  if (isPaidProviderHost(url.origin)) throw new Error(`Paid host refused: ${url.hostname}`);
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Docs indexing keeps the spend gate closed.');
  return url;
}

export async function indexDocFolder(
  project: string,
  folder: string,
  options?: { embed?: (texts: string[]) => Promise<number[][]> },
): Promise<DocsIndexResult> {
  const root = path.resolve(folder);
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Docs folder is not a real directory.');
  const texts: Array<{ rel: string; text: string; mtimeMs: number; size: number }> = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || SKIP.has(entry.name) || entry.name.startsWith('.env')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await fs.stat(abs);
      if (fileStat.size > 200_000) continue;
      const text = await fs.readFile(abs, 'utf8');
      if (text.includes('\0')) continue;
      texts.push({ rel: path.relative(root, abs).split(path.sep).join('/'), text, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
    }
  }
  await visit(root);
  if (!texts.length) return { paths: [], fetched: false };
  const vectors = await embed(texts.map((file) => file.text.slice(0, 2000)), options?.embed);
  const rows: VectorRow[] = texts.map((file, index) => ({
    path: `docs:folder/${file.rel}`,
    mtimeMs: file.mtimeMs,
    size: file.size,
    vector: vectors[index],
  }));
  await mergeDocRows(project, rows);
  return { paths: rows.map((row) => row.path), fetched: false };
}

export async function indexDocUrl(
  project: string,
  rawUrl: string,
  options?: { fetchText?: (url: string) => Promise<string>; embed?: (texts: string[]) => Promise<number[][]> },
): Promise<DocsIndexResult> {
  const url = assertDocUrl(rawUrl).toString();
  const cache = await readCache(project);
  let fetched = false;
  let text = cache.urls[url];
  if (!text) {
    text = strip(await (options?.fetchText ?? fetchText)(url)).slice(0, 200_000);
    cache.urls[url] = text;
    await writeCache(project, cache);
    fetched = true;
  }
  const [vector] = await embed([text.slice(0, 2000)], options?.embed);
  const row: VectorRow = {
    path: `docs:url/${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
    mtimeMs: Date.now(),
    size: text.length,
    vector,
  };
  await mergeDocRows(project, [row]);
  return { paths: [row.path], fetched };
}

async function embed(texts: string[], injected?: (texts: string[]) => Promise<number[][]>): Promise<number[][]> {
  if (injected) return injected(texts);
  return embedTexts({ host: 'http://127.0.0.1:11434', input: texts });
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Docs fetch failed: ${res.status}`);
  return res.text();
}

function strip(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cachePath(project: string): string {
  return path.join(path.resolve(project), '.jewbot', 'index', 'docs-cache.json');
}

async function readCache(project: string): Promise<{ urls: Record<string, string> }> {
  try {
    const parsed = JSON.parse(await fs.readFile(cachePath(project), 'utf8')) as { urls?: Record<string, string> };
    return { urls: parsed.urls && typeof parsed.urls === 'object' ? parsed.urls : {} };
  } catch {
    return { urls: {} };
  }
}

async function writeCache(project: string, cache: { urls: Record<string, string> }): Promise<void> {
  const file = cachePath(project);
  const decision = assertInsideProject(path.resolve(project), path.relative(path.resolve(project), file));
  if (!decision.ok) throw new Error(decision.reason);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(cache)}\n`, 'utf8');
}

export const jewbotModule: JewbotModule = {
  id: 'docs',
  title: 'Local docs',
  description: 'Index a local folder or one public URL into the embedding store. Later @docs queries stay offline.',
  version: '0.4.0',
  capabilities: ['search', 'local-only'],
  tools: [{ name: 'docs_index', description: 'Embed a local folder or a one-time public page into .jewbot/index. Paid hosts are refused.' }],
  health() {
    return { ok: true, detail: 'docs cache idle' };
  },
};
