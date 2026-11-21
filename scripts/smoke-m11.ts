/**
 * M11 semantic index smoke. Mocked embeddings. No live Ollama.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expandMentions, parseMentions, reindex, semanticSearch } from '../src/modules/semantic';
import { embedTexts } from '../src/modules/semantic/embed';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function vector(seed: number): number[] {
  return [seed, 1 - seed, 0.2];
}

async function withEmbedFetch(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(url === 'http://127.0.0.1:11434/api/embed', `embed url ${url}`);
    const body = JSON.parse(String(init?.body)) as { model?: string; input?: string[] };
    expect(body.model === 'nomic-embed-text', `model ${body.model}`);
    const rows = (body.input || []).map((text) => vector(text.includes('alpha') ? 1 : 0));
    return new Response(JSON.stringify({ embeddings: rows }), { status: 200 });
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function testIndexAndSearch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m11-'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'secret.txt\n');
  fs.writeFileSync(path.join(root, 'alpha.ts'), 'alpha widget\n');
  fs.writeFileSync(path.join(root, 'beta.ts'), 'beta other\n');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'token\n');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'skip.js'), 'nope\n');
  await withEmbedFetch(async () => {
    const first = await reindex(root, { host: 'http://127.0.0.1:11434' });
    expect(first.updated.includes('alpha.ts') && first.updated.includes('beta.ts'), `updated ${first.updated.join()}`);
    expect(!first.updated.includes('secret.txt') && !first.updated.includes('node_modules/skip.js'), 'ignored files stay out');
    const again = await reindex(root, { host: 'http://127.0.0.1:11434' });
    expect(again.updated.length === 0 && again.skipped.length >= 2, `incremental ${again.updated.length} ${again.skipped.length}`);
    fs.writeFileSync(path.join(root, 'alpha.ts'), 'alpha widget changed\n');
    const third = await reindex(root, { host: 'http://127.0.0.1:11434' });
    expect(third.updated.join() === 'alpha.ts', `only changed file ${third.updated.join()}`);
    const hits = await semanticSearch(root, 'alpha widget', 2, { host: 'http://127.0.0.1:11434' });
    expect(hits[0]?.path === 'alpha.ts', `top hit ${hits[0]?.path}`);
    const store = fs.readFileSync(path.join(root, '.jewbot', 'index', 'vectors.json'), 'utf8');
    expect(store.includes('nomic-embed-text'), 'store names the local model');
  });
}

async function testMentionsAndPaidRefusal() {
  const mentions = parseMentions('see @file src/a.ts and @folder src and @codebase login');
  expect(mentions.map((item) => item.kind).join() === 'file,folder,codebase', mentions.map((item) => item.kind).join());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m11-mention-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const login = 1;\n');
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ embeddings: [[1, 0, 0]] }), { status: 200 });
  };
  try {
    const expanded = await expandMentions(root, 'look @file src/a.ts @folder src', { host: 'http://127.0.0.1:11434' });
    expect(expanded.includes('export const login') && expanded.includes('a.ts'), expanded);
    fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error('fetch should not run');
    };
    let refused = false;
    try {
      await embedTexts({ host: 'https://api.openai.com/v1', input: ['x'] });
    } catch (err) {
      refused = /Refusing/.test(err instanceof Error ? err.message : String(err));
    }
    expect(refused && fetches === 0, 'paid embed host is not fetched');
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  await testIndexAndSearch();
  await testMentionsAndPaidRefusal();
  console.log('smoke-m11: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
