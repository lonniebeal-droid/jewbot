/**
 * M21 local docs. Folder index and a one-time public fetch, then offline cache.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { indexDocFolder, indexDocUrl } from '../src/modules/docs';
import { expandMentions, reindex, searchDocs } from '../src/modules/semantic';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m21-'));
  const folder = path.join(root, 'notes');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'guide.txt'), 'local ollama embeddings\n');
  await fs.writeFile(path.join(folder, '.env'), 'SECRET=1\n');
  const embed = async (texts: string[]) => texts.map(() => [1, 0]);
  const original = globalThis.fetch;
  let fetches = 0;
  try {
    const indexed = await indexDocFolder(root, folder, { embed });
    expect(indexed.paths.length === 1 && indexed.paths[0] === 'docs:folder/guide.txt', indexed.paths.join(','));
    globalThis.fetch = async (url) => {
      fetches += 1;
      if (!String(url).includes('/api/embed')) throw new Error(`unexpected ${url}`);
      return new Response(JSON.stringify({ embeddings: [[1, 0]] }), { status: 200 });
    };
    const hits = await searchDocs(root, 'embeddings', 3, { host: 'http://127.0.0.1:11434' });
    expect(hits[0]?.path === 'docs:folder/guide.txt', JSON.stringify(hits));
    const expanded = await expandMentions(root, 'see @docs embeddings', { host: 'http://127.0.0.1:11434' });
    expect(expanded.includes('docs:folder/guide.txt'), expanded);
    await reindex(root, { host: 'http://127.0.0.1:11434' });
    const after = await searchDocs(root, 'embeddings', 3, { host: 'http://127.0.0.1:11434' });
    expect(after[0]?.path === 'docs:folder/guide.txt', 'reindex keeps docs rows');

    let pageFetches = 0;
    const first = await indexDocUrl(root, 'https://example.com/guide', {
      embed,
      fetchText: async () => {
        pageFetches += 1;
        return '<p>public guide</p>';
      },
    });
    const second = await indexDocUrl(root, 'https://example.com/guide', {
      embed,
      fetchText: async () => {
        pageFetches += 1;
        return 'should not run';
      },
    });
    expect(first.fetched === true && second.fetched === false && pageFetches === 1, `fetches ${pageFetches}`);
    const cache = await fs.readFile(path.join(root, '.jewbot', 'index', 'docs-cache.json'), 'utf8');
    expect(cache.includes('public guide') && !cache.includes('<p>'), 'the page is cached as text');

    let paid = false;
    try {
      await indexDocUrl(root, 'https://api.openai.com/v1/docs', { embed, fetchText: async () => 'nope' });
    } catch (err) {
      paid = /Paid host/.test(err instanceof Error ? err.message : '');
    }
    expect(paid, 'a paid host is refused');

    const renderer = await fs.readFile(path.join(process.cwd(), 'src/renderer/renderer.js'), 'utf8');
    expect(renderer.includes('docsIndexUrl') && renderer.includes('docsFolder'), 'the window can index docs');
  } finally {
    globalThis.fetch = original;
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('smoke-m21: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
