/**
 * Music release smoke: local weekly checklist, human gates, mocked Ollama.
 * No DistroKid, no Spotify, no payment, no live model, no destructive ops.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../src/modules/agent';
import { jewbotModule as agentModule } from '../src/modules/agent/manifest';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import * as modules from '../src/modules';
import {
  addMusicRelease,
  draftReleaseNotes,
  jewbotModule,
  MUSIC_HUMAN_GATE_REASON,
  musicListReleases,
  musicMark,
  musicNextFree,
  parseMusicQueue,
  QUEUE_VERSION,
  runMusicTool,
} from '../src/modules/music-release';
import { resetOllamaHealthCache } from '../src/modules/plugin/health';
import { SshManager } from '../src/modules/ssh';
import { TerminalSession } from '../src/modules/terminal';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown> | unknown, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    expect(re.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

function tempStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-music-'));
}

function queueFile(root: string): string {
  return path.join(root, '.jewbot', 'music-release.json');
}

function readQueue(root: string): unknown {
  return JSON.parse(fs.readFileSync(queueFile(root), 'utf8'));
}

const album = {
  title: 'Week 45',
  artist: 'JU Music',
  week: '2026-W45',
  tracks: [
    { title: 'Atlanta Night', artist: 'JU Music' },
    { title: 'Southbound' },
  ],
};

function testModuleShape() {
  expect(jewbotModule.id === 'music-release', 'id');
  expect(jewbotModule.version === '0.2.0', `version ${jewbotModule.version}`);
  expect(!jewbotModule.capabilities.includes('stub'), 'no longer a stub');
  expect(jewbotModule.capabilities.includes('local-only'), 'local-only capability');
  const names = (jewbotModule.tools || []).map((tool) => tool.name);
  expect(names.join() === 'music_list_releases,music_next_free,music_mark', `tools ${names.join()}`);
  expect(typeof jewbotModule.health === 'function', 'health is a function');
  expect(modules.musicRelease.jewbotModule === jewbotModule, 'namespace exports the module');
  expect(typeof modules.musicRelease.musicNextFree === 'function', 'namespace exports musicNextFree');
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/music-release/index.ts'), 'utf8');
  expect(!source.includes('migrationStub'), 'index is not the migration stub');
  const draft = fs.readFileSync(path.join(__dirname, '../src/modules/music-release/draft.ts'), 'utf8');
  expect(draft.includes('assertLocalSpendOnly'), 'draft calls assertLocalSpendOnly');
  expect(draft.includes('chatOnce'), 'draft calls chatOnce');
  const gitignore = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
  expect(gitignore.includes('.jewbot/'), '.jewbot is gitignored');
}

function testExampleFile() {
  const examplePath = path.join(__dirname, '../docs/examples/music-release.example.json');
  const raw = JSON.parse(fs.readFileSync(examplePath, 'utf8')) as unknown;
  const parsed = parseMusicQueue(raw);
  expect(parsed.version === QUEUE_VERSION, 'example version');
  expect(parsed.releases.length >= 2, 'example has a pending release and a gated one');
  const pending = parsed.releases.find((row) => row.status === 'pending');
  const blocked = parsed.releases.find((row) => row.status === 'blocked');
  expect(!!pending && pending.artist === 'JU Music', 'example artist');
  expect(!!pending && pending.tracks.length >= 1, 'example tracks');
  expect(!!blocked && /distrokid/i.test(blocked.reason || ''), 'example names the DistroKid gate');
  expect(parsed.releases.every((row) => row.status === 'pending' || row.status === 'blocked' || row.status === 'done'), 'statuses');
}

function testQueueRoundTrip() {
  const root = tempStore();
  expect(musicListReleases({ storeRoot: root }).length === 0, 'missing file is an empty queue');
  const created = addMusicRelease(album, { storeRoot: root });
  expect(created.status === 'pending' && created.step === 'tracks', 'new release starts at tracks');
  expect(created.id.startsWith('rel_'), `id ${created.id}`);
  expect(created.tracks.length === 2, 'tracks stored');
  expect(created.tracks[1].artist === undefined, 'track artist is optional');
  const listed = musicListReleases({ storeRoot: root });
  expect(listed.length === 1 && listed[0].title === 'Week 45', 'list reads the file');
  listed[0].status = 'done';
  expect(musicListReleases({ storeRoot: root })[0].status === 'pending', 'list returns copies');
  const onDisk = readQueue(root) as { version: number; releases: unknown[] };
  expect(onDisk.version === 1 && onDisk.releases.length === 1, 'schema version 1');
  const mode = fs.statSync(queueFile(root)).mode & 0o777;
  expect(mode === 0o600, `queue mode ${mode.toString(8)}`);

  fs.writeFileSync(queueFile(root), '{', 'utf8');
  let refused = false;
  try {
    addMusicRelease(album, { storeRoot: root });
  } catch (err) {
    refused = /left untouched/.test(err instanceof Error ? err.message : String(err));
  }
  expect(refused, 'corrupt queue is not overwritten');
  expect(fs.readFileSync(queueFile(root), 'utf8') === '{', 'corrupt bytes stay');
}

async function testFreeStepsThenGate() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  const root = tempStore();
  try {
    const empty = addMusicRelease({ title: 'Week 44', artist: 'JU Music', week: '2026-W44', tracks: [] }, { storeRoot: root });
    const waiting = await musicNextFree({ storeRoot: root });
    expect(waiting.action === 'waiting' && waiting.humanGate === false, `empty tracks wait (${waiting.action})`);
    expect(waiting.release?.id === empty.id, 'head of the queue is the one considered');
    expect(fetches === 0, 'waiting does not fetch');

    const release = addMusicRelease(album, { storeRoot: root });
    expect(release.id !== empty.id, 'second id');
    const stillWaiting = await musicNextFree({ storeRoot: root });
    expect(stillWaiting.release?.id === empty.id, 'does not skip a release that still needs tracks');

    musicMark({ id: empty.id, status: 'blocked', reason: 'Owner is still picking the track list.' }, { storeRoot: root });
    const advanced = await musicNextFree({ storeRoot: root });
    expect(advanced.action === 'advanced' && advanced.release?.step === 'notes', `advanced to notes (${advanced.release?.step})`);
    expect(advanced.release?.status === 'pending', 'notes step stays pending');
    expect(fetches === 0, 'track check does not fetch');

    const needsNotes = await musicNextFree({ storeRoot: root });
    expect(needsNotes.action === 'waiting', `notes wait (${needsNotes.detail})`);
    expect(/draft/i.test(needsNotes.detail), 'waiting points at the optional draft');
    expect(fetches === 0, 'draft off does not fetch');

    const drafted = await musicNextFree({ storeRoot: root, draft: true });
    expect(drafted.action === 'waiting', 'down ollama does not invent notes');
    expect(drafted.release?.status === 'pending' && drafted.release.step === 'notes', 'failed draft does not advance');
    expect(fetches > 0, 'draft attempts local ollama');
  } finally {
    globalThis.fetch = original;
  }
}

async function testDraftThenBlock() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const savedToken = process.env.DISTROKID_TOKEN;
  process.env.DISTROKID_TOKEN = 'must-not-appear-in-music-traffic';
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const body = String(init?.body ?? '');
    expect(!body.includes('must-not-appear-in-music-traffic'), 'distributor token must not be sent');
    expect(url === 'http://127.0.0.1:11434/api/chat', `chat url ${url}`);
    expect(body.includes('JU Music') && body.includes('Atlanta Night'), 'draft prompt names the album');
    expect(/do not claim/i.test(body), 'prompt forbids claiming an upload');
    return new Response(
      ndjson('Uploaded to DistroKid and paid the plan. These notes are done.'),
      { status: 200 },
    );
  };
  const root = tempStore();
  try {
    const release = addMusicRelease({ ...album, notes: '' }, { storeRoot: root });
    await musicNextFree({ storeRoot: root });
    const drafted = await musicNextFree({ storeRoot: root, draft: true });
    expect(drafted.action === 'drafted', `drafted (${drafted.detail})`);
    expect(drafted.release?.status === 'pending', 'model text does not mark done');
    expect(drafted.release?.step === 'ready', `step ${drafted.release?.step}`);
    expect((drafted.release?.notes || '').includes('Uploaded to DistroKid'), 'notes keep the draft text');
    expect(!JSON.stringify(readQueue(root)).includes('must-not-appear-in-music-traffic'), 'token not stored');

    calls.length = 0;
    const gated = await musicNextFree({ storeRoot: root });
    expect(gated.action === 'blocked' && gated.humanGate === true, `gate (${gated.action})`);
    expect(gated.release?.status === 'blocked' && gated.release.step === 'distribute', 'blocked at distribute');
    expect(gated.release?.reason === MUSIC_HUMAN_GATE_REASON, gated.release?.reason || 'missing reason');
    expect(/distrokid/i.test(gated.release?.reason || '') && /spotify/i.test(gated.release?.reason || ''), 'reason names the gates');
    expect(/pay/i.test(gated.release?.reason || ''), 'reason names payment');
    expect(calls.length === 0, 'the gate does not fetch');
    expect(musicListReleases({ storeRoot: root })[0].status === 'blocked', 'gate is persisted');

    const skipped = await musicNextFree({ storeRoot: root });
    expect(skipped.action === 'none', 'blocked release is not selected again');

    const done = musicMark({ id: release.id, status: 'done', notes: 'Owner finished the store step.' }, { storeRoot: root });
    expect(done.status === 'done', 'owner mark done is local');
    expect(done.reason === undefined, 'done clears the gate reason');
    expect(calls.length === 0, 'mark done does not fetch');
  } finally {
    globalThis.fetch = original;
    if (savedToken === undefined) delete process.env.DISTROKID_TOKEN;
    else process.env.DISTROKID_TOKEN = savedToken;
  }
}

async function testExistingNotesSkipDraft() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  const root = tempStore();
  try {
    addMusicRelease({ ...album, notes: 'Written on the laptop.' }, { storeRoot: root });
    await musicNextFree({ storeRoot: root });
    const ready = await musicNextFree({ storeRoot: root, draft: true });
    expect(ready.action === 'advanced' && ready.release?.step === 'ready', `notes already present (${ready.action})`);
    expect(ready.release?.notes === 'Written on the laptop.', 'existing notes stay');
    expect(fetches === 0, 'existing notes do not call ollama');
  } finally {
    globalThis.fetch = original;
  }
}

async function testRefusesPaidDraft() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  const root = tempStore();
  try {
    process.env.JEWBOT_ALLOW_PAID = '1';
    const release = addMusicRelease(album, { storeRoot: root });
    await musicNextFree({ storeRoot: root });
    const hosts = ['https://api.openai.com/v1', 'https://api.x.ai', 'http://192.168.1.9:11434'];
    for (const host of hosts) {
      fetches = 0;
      const result = await musicNextFree({
        storeRoot: root,
        draft: true,
        config: { host, model: 'paid', allowPaidApis: true },
      });
      expect(result.action === 'waiting' && result.release?.status === 'pending', `${host} does not advance`);
      expect(/Paid\/cloud|Refusing/i.test(result.detail), `${host} detail ${result.detail}`);
      expect(fetches === 0, `${host} fetched ${fetches}`);
    }
    await expectThrow(
      () => draftReleaseNotes(release, { host: 'https://api.grok.com', model: 'grok', allowPaidApis: true }),
      /Paid\/cloud|Refusing/i,
      'direct draft refuses grok',
    );
    expect(fetches === 0, 'direct draft fetched');
    expect(musicListReleases({ storeRoot: root })[0].step === 'notes', 'paid refusal leaves the step');
  } finally {
    globalThis.fetch = original;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testToolGate() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  const root = tempStore();
  try {
    const release = addMusicRelease(album, { storeRoot: root });
    const listed = await runMusicTool('music_list_releases', {}, { storeRoot: root });
    expect(Array.isArray((listed as { releases: unknown[] }).releases), 'list tool returns releases');

    const uploaded = await runMusicTool('music_next_free', { upload: true, intent: 'distrokid' }, { storeRoot: root });
    const gated = uploaded as { humanGate: boolean; action: string; release: { status: string; reason?: string } };
    expect(gated.humanGate === true && gated.action === 'blocked', 'upload intent blocks');
    expect(gated.release.status === 'blocked', 'upload intent persists blocked');
    expect(/distrokid/i.test(gated.release.reason || ''), gated.release.reason || 'missing reason');
    expect(fetches === 0, 'upload intent fetched');

    const marked = await runMusicTool(
      'music_mark',
      { id: release.id, status: 'done', pay: true, intent: 'checkout the DistroKid plan' },
      { storeRoot: root },
    );
    expect((marked as { status: string }).status === 'blocked', 'pay intent cannot mark done');
    expect(fetches === 0, 'pay intent fetched');

    const done = await runMusicTool('music_mark', { id: release.id, status: 'done' }, { storeRoot: root });
    expect((done as { status: string }).status === 'done', 'plain mark done stays local');

    await expectThrow(() => runMusicTool('music_upload', {}, { storeRoot: root }), /Unknown music tool/, 'no upload tool');
    await expectThrow(
      () => musicMark({ id: 'rel_nope', status: 'done' }, { storeRoot: root }),
      /not found/,
      'unknown id',
    );
  } finally {
    globalThis.fetch = original;
  }
}

async function testHealthPing() {
  const original = globalThis.fetch;
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  let calls = 0;
  try {
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
    process.env.JEWBOT_ALLOW_PAID = '0';
    resetOllamaHealthCache();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      calls += 1;
      expect(String(input) === 'http://127.0.0.1:11434/api/tags', `tags url ${String(input)}`);
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 });
    };
    const health = await jewbotModule.health();
    expect(health.ok === true && (health.detail || '').includes('qwen2.5-coder:7b'), `health ${health.detail}`);
    expect(calls === 1, `tags ping once (${calls})`);

    resetOllamaHealthCache();
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('connect ECONNREFUSED');
    };
    const down = await jewbotModule.health();
    expect(down.ok === false && (down.detail || '').length > 0, 'down health explains itself');

    resetOllamaHealthCache();
    calls = 0;
    process.env.OLLAMA_HOST = 'https://api.x.ai';
    const refused = await jewbotModule.health();
    expect(refused.ok === false, 'health refuses x.ai');
    expect(/paid provider|Paid\/cloud|Refusing/i.test(refused.detail || ''), refused.detail || 'no detail');
    expect(calls === 0, `refused health fetched ${calls}`);
  } finally {
    globalThis.fetch = original;
    resetOllamaHealthCache();
    if (savedHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = savedHost;
    if (savedModel === undefined) delete process.env.JEWBOT_MODEL;
    else process.env.JEWBOT_MODEL = savedModel;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testAgentTools() {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const root = tempStore();
  const release = addMusicRelease(album, { storeRoot: root });
  let step = 0;
  const script = [
    JSON.stringify({ tool: 'music_list_releases', args: {} }),
    JSON.stringify({
      tool: 'music_next_free',
      args: { upload: true, draft: true, host: 'https://api.openai.com/v1', intent: 'distrokid' },
    }),
    JSON.stringify({
      tool: 'music_mark',
      args: { id: release.id, status: 'done', pay: true, intent: 'checkout the DistroKid plan' },
    }),
    'FINAL: still blocked',
  ];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    expect(url === 'http://127.0.0.1:11434/api/chat', `agent url ${url}`);
    const content = script[Math.min(step, script.length - 1)];
    step += 1;
    return new Response(ndjson(content), { status: 200 });
  };
  try {
    const names = (agentModule.tools || []).map((tool) => tool.name);
    expect(names.includes('music_list_releases') && names.includes('music_next_free') && names.includes('music_mark'), names.join());
    const agent = new AgentLoop({
      files: new FileWorkspace(root),
      terminal: new TerminalSession(),
      ssh: new SshManager({ autoload: false }),
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 6,
    });
    let observations = '';
    let final = '';
    for await (const ev of agent.runStream('advance the weekly album')) {
      if (ev.type === 'done') {
        final = ev.result.finalText || '';
        observations = ev.result.steps.map((item) => item.observation || '').join('\n');
      }
    }
    expect(final === 'still blocked', `final ${final}`);
    expect(observations.includes('JU Music') && observations.includes('Week 45'), observations);
    expect(observations.includes('humanGate'), 'agent observation names the human gate');
    expect(/distrokid/i.test(observations), observations);
    expect(musicListReleases({ storeRoot: root })[0].status === 'blocked', 'pay intent from the agent stays blocked');
    expect(urls.every((url) => url === 'http://127.0.0.1:11434/api/chat'), `urls ${urls.join(',')}`);
  } finally {
    globalThis.fetch = original;
  }
}

async function testReleaseDoneGate() {
  const original = globalThis.fetch;
  const root = tempStore();
  const release = addMusicRelease(album, { storeRoot: root });
  const runOnce = async (approved: boolean) => {
    let step = 0;
    const script = [
      JSON.stringify({ tool: 'music_mark', args: { id: release.id, status: 'done' } }),
      'FINAL: done requested',
    ];
    globalThis.fetch = async () => {
      const content = script[Math.min(step, script.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const agent = new AgentLoop({
      files: new FileWorkspace(root),
      terminal: new TerminalSession(),
      ssh: new SshManager({ autoload: false }),
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 6,
      confirmReleaseDone: async () => approved,
    });
    let observations = '';
    for await (const ev of agent.runStream('mark the weekly album done')) {
      if (ev.type === 'done') {
        observations = ev.result.steps.map((item) => item.observation || '').join('\n');
      }
    }
    return observations;
  };
  try {
    const refused = await runOnce(false);
    expect(refused.includes('REFUSED'), `declined done should refuse (${refused})`);
    expect(musicListReleases({ storeRoot: root })[0].status === 'pending', 'declined done leaves release pending');
    const approved = await runOnce(true);
    expect(!approved.includes('REFUSED'), `approved done should apply (${approved})`);
    expect(musicListReleases({ storeRoot: root })[0].status === 'done', 'approved done marks release done');
  } finally {
    globalThis.fetch = original;
  }
}

function testSourcesStayLocal() {
  const dir = path.join(__dirname, '../src/modules/music-release');
  const banned = ['distrokid.com', 'spotify.com', 'api.spotify.com', 'openai.com', 'api.x.ai', 'stripe.com'];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8').toLowerCase();
    for (const needle of banned) {
      expect(!text.includes(needle), `${file} contains ${needle}`);
    }
  }
}

async function main() {
  testModuleShape();
  testExampleFile();
  testSourcesStayLocal();
  testQueueRoundTrip();
  await testFreeStepsThenGate();
  await testDraftThenBlock();
  await testExistingNotesSkipDraft();
  await testRefusesPaidDraft();
  await testToolGate();
  await testHealthPing();
  await testAgentTools();
  await testReleaseDoneGate();
  console.log('smoke-music: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
