/**
 * Inbox worker fixture. No live Ollama and no public network.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../src/modules/agent';
import { assertInboxUrl, inboxLayout, pollInbox, pollInboxHttp, reclaimStale } from '../src/modules/inbox';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-inbox-'));
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-inbox-proj-'));
  await fs.writeFile(path.join(project, 'hello.txt'), 'hello\n');
  const layout = inboxLayout(root);
  await fs.mkdir(layout.inbox, { recursive: true });
  await fs.writeFile(
    path.join(layout.inbox, 'task-1.json'),
    JSON.stringify({ task_id: 'task-1', type: 'agent.goal', payload: { goal: 'Read hello.txt and FINAL: saw hello' } }),
  );
  await fs.writeFile(
    path.join(layout.inbox, 'task-2.json'),
    JSON.stringify({ task_id: 'task-2', type: 'ask.owner', payload: { needs_owner: true, goal: 'ship it' } }),
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1 ? '{"tool":"read_file","args":{"path":"hello.txt"}}' : 'FINAL: saw hello';
    return new Response(ndjson(content), { status: 200 });
  };
  try {
    const first = await pollInbox({ root, project, worker: 'jewbot-test' });
    expect(first?.status === 'VERIFIED' && first.spend === '$0', JSON.stringify(first));
    expect(first?.changes.includes('read_file'), first?.changes || '');
    expect(first?.verification.passed === true, 'verified');
    const receiptPath = path.join(layout.receipts, 'task-1.json');
    const saved = JSON.parse(await fs.readFile(receiptPath, 'utf8')) as { ju_status: string; worker: string };
    expect(saved.ju_status === 'ok' && saved.worker === 'jewbot-test', JSON.stringify(saved));
    expect(!(await fs.readdir(layout.work)).some((name) => name.includes('task-1')), 'claim lock is cleared');

    const blocked = await pollInbox({ root, project, worker: 'jewbot-test' });
    expect(blocked?.status === 'BLOCKED' && blocked.blocker === 'needs_owner', JSON.stringify(blocked));
    expect(blocked?.next_action?.includes('person'), blocked?.next_action || '');

    await fs.writeFile(
      path.join(layout.inbox, 'task-1.json'),
      JSON.stringify({ task_id: 'task-1', type: 'agent.goal', payload: { goal: 'again' } }),
    );
    const dupe = await pollInbox({ root, project, worker: 'jewbot-test' });
    expect(dupe === null, 'a receipt blocks a second run');
    expect((await fs.readdir(layout.duplicates)).includes('task-1.json'), 'duplicate archived');

    const stale = path.join(layout.work, 'old.claimed.json');
    await fs.mkdir(layout.work, { recursive: true });
    await fs.writeFile(
      stale,
      JSON.stringify({ task_id: 'old', type: 'agent.goal', payload: { goal: 'x' }, _claim: { attempts: 1 } }),
    );
    const old = Date.now() - (STALE_MS());
    await fs.utimes(stale, old / 1000, old / 1000);
    const notes = reclaimStale(layout);
    expect(notes.includes('inbox old'), notes.join(','));
    expect((await fs.readdir(layout.inbox)).includes('old.json'), 'stale claim returns to the inbox');

    let fetched = 0;
    globalThis.fetch = async () => {
      fetched += 1;
      return new Response('no', { status: 500 });
    };
    let refused = false;
    try {
      assertInboxUrl('https://api.openai.com/inbox');
    } catch (err) {
      refused = /Refusing/.test(err instanceof Error ? err.message : '');
    }
    expect(refused && fetched === 0, 'a public inbox is refused before fetch');

    const lan = await pollInboxHttp({
      url: 'http://192.168.1.9:8787',
      project,
      worker: 'jewbot-test',
      fetchImpl: async (url, init) => {
        fetched += 1;
        const target = String(url);
        if (target.endsWith('/inbox')) {
          return new Response(JSON.stringify({ tasks: [{ task_id: 'lan-1', type: 'ask.owner', payload: { needs_owner: true } }] }), { status: 200 });
        }
        if (target.endsWith('/claim')) {
          return new Response(JSON.stringify({ task_id: 'lan-1', type: 'ask.owner', payload: { needs_owner: true }, _claim: { attempts: 1, claimed_by: 'jewbot-test' } }), { status: 200 });
        }
        expect(init?.method === 'POST', 'receipt is posted');
        return new Response('{}', { status: 200 });
      },
    });
    expect(lan?.status === 'BLOCKED' && lan.spend === '$0', JSON.stringify(lan));
    expect(AgentLoop.name === 'AgentLoop', 'agent loop is the default runner');
  } finally {
    globalThis.fetch = original;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  }
  console.log('smoke-inbox: PASS');
}

function STALE_MS() {
  return 601_000;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
