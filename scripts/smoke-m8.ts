/**
 * M8 hub smoke. No live Ollama. No paid APIs. Fetch is mocked.
 * Registry, discovery, paid-host refusal, and stub/Muse health.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listReleaseBlockers, MuseFinisherModule } from '../src/modules/muse';
import {
  bootModules,
  discoverModules,
  getModule,
  lastBootErrors,
  listModuleHealth,
  listModules,
  moduleChat,
  registerModule,
  resetOllamaHealthCache,
  resetRegistry,
  shutdownModules,
  unregisterModule,
  type JewbotModule,
} from '../src/modules/plugin';

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

const MODULES_ROOT = path.join(__dirname, '../src/modules');
const EXPECTED = [
  'llm',
  'agent',
  'terminal',
  'ssh',
  'files',
  'cascade',
  'safety',
  'context',
  'muse',
  'music-release',
  'fleet-triage',
  'street-trader',
  'twinrent',
  'portfolio-sweeper',
  'echo',
];

function sample(id: string, extra: Partial<JewbotModule> = {}): JewbotModule {
  return {
    id,
    title: `Title ${id}`,
    description: `Description for ${id}`,
    version: '1.2.3',
    capabilities: ['test'],
    health: async () => ({ ok: true, detail: 'loaded' }),
    ...extra,
  };
}

function testRegistry() {
  resetRegistry();
  registerModule(sample('zebra'));
  registerModule(sample('alpha', { tools: [{ name: 'ping', description: 'Ping' }] }));
  const ids = listModules().map((mod) => mod.id);
  expect(ids.join() === 'alpha,zebra', `sorted list ${ids.join()}`);
  expect(getModule('alpha')?.tools?.[0].name === 'ping', 'get returns the module');
  expect(getModule('missing') === undefined, 'missing get is undefined');
  let duplicate = false;
  try {
    registerModule(sample('alpha'));
  } catch (err) {
    duplicate = /already registered/.test(err instanceof Error ? err.message : String(err));
  }
  expect(duplicate, 'duplicate register throws');
  let badId = false;
  try {
    registerModule(sample('NoCaps'));
  } catch (err) {
    badId = /invalid id/.test(err instanceof Error ? err.message : String(err));
  }
  expect(badId, 'bad id throws');
  expect(unregisterModule('alpha') === true, 'unregister alpha');
  expect(getModule('alpha') === undefined, 'alpha gone');
  expect(unregisterModule('alpha') === false, 'second unregister is false');
  expect(listModules().length === 1 && listModules()[0].id === 'zebra', 'zebra remains');
  resetRegistry();
  expect(listModules().length === 0, 'reset clears');
}

function testDiscovery() {
  const found = discoverModules(MODULES_ROOT);
  expect(found.errors.length === 0, `discover errors: ${found.errors.join(' | ')}`);
  const ids = found.modules.map((mod) => mod.id);
  for (const id of EXPECTED) expect(ids.includes(id), `discovered ${id}`);
  const muse = found.modules.find((mod) => mod.id === 'muse');
  expect(!!muse && muse.title === 'Muse Finisher', 'discovered muse is the finisher');
  expect(muse?.capabilities.includes('finish') === true, 'muse keeps finish capability');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m8-'));
  fs.mkdirSync(path.join(root, 'widget'));
  fs.writeFileSync(
    path.join(root, 'widget', 'jewbot.module.json'),
    JSON.stringify({
      id: 'widget',
      title: 'Widget',
      description: 'JSON manifest',
      version: '1.0.0',
      capabilities: ['chat'],
      tools: [{ name: 'note', description: 'A note' }],
    }),
  );
  fs.mkdirSync(path.join(root, 'plugin'));
  fs.writeFileSync(
    path.join(root, 'plugin', 'jewbot.module.json'),
    JSON.stringify({
      id: 'plugin',
      title: 'Plugin',
      description: 'Should be skipped',
      version: '1.0.0',
      capabilities: ['nope'],
    }),
  );
  fs.mkdirSync(path.join(root, 'broken'));
  fs.writeFileSync(path.join(root, 'broken', 'jewbot.module.json'), '{');
  fs.mkdirSync(path.join(root, 'mismatch'));
  fs.writeFileSync(
    path.join(root, 'mismatch', 'jewbot.module.json'),
    JSON.stringify({
      id: 'other',
      title: 'Other',
      description: 'Wrong folder',
      version: '1.0.0',
      capabilities: ['chat'],
    }),
  );
  const extra = discoverModules(root);
  expect(extra.modules.length === 1 && extra.modules[0].id === 'widget', 'json manifest loads');
  expect(extra.modules[0].tools?.[0].name === 'note', 'json tools kept');
  expect(!extra.modules.some((mod) => mod.id === 'plugin'), 'plugin directory is not a module');
  expect(extra.errors.some((line) => line.startsWith('broken:')), `broken json noted (${extra.errors.join(' | ')})`);
  expect(extra.errors.some((line) => line.startsWith('mismatch:')), 'id mismatch noted');
}

function testRealMuse() {
  const tasks = listReleaseBlockers();
  expect(tasks.length === 5, 'five blockers');
  expect(tasks.every((task) => task.status === 'open'), 'blockers stay open');
  const finisher = new MuseFinisherModule({ host: 'http://127.0.0.1:11434', model: 'test-model' });
  expect(finisher.blockers().every((task) => task.status === 'open'), 'class still returns open blockers');
  const source = fs.readFileSync(path.join(MODULES_ROOT, 'muse', 'index.ts'), 'utf8');
  expect(source.includes('class MuseFinisherModule'), 'real muse class is still in index.ts');
  expect(!source.includes('migrationStub'), 'muse index was not replaced with a stub');
}

async function testBoot() {
  resetRegistry();
  const booted = await bootModules(MODULES_ROOT);
  const ids = booted.map((mod) => mod.id);
  for (const id of EXPECTED) expect(ids.includes(id), `booted ${id}`);
  expect(lastBootErrors().length === 0, `boot errors: ${lastBootErrors().join(' | ')}`);
  expect(getModule('muse')?.title === 'Muse Finisher', 'boot registered real muse');
  const again = await bootModules(MODULES_ROOT);
  expect(again.length === booted.length, 'second boot does not duplicate');
  let stopped = false;
  registerModule(
    sample('stop-me', {
      stop() {
        stopped = true;
      },
    }),
  );
  await shutdownModules();
  expect(stopped, 'shutdown calls stop');
  unregisterModule('stop-me');
}

async function testPaidRefusal() {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch should not run');
  };
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  try {
    process.env.JEWBOT_ALLOW_PAID = '0';
    process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
    const hosts = [
      'https://api.openai.com/v1',
      'https://api.anthropic.com',
      'https://api.x.ai',
      'https://grok.x.ai',
      'https://api.grok.com',
      'http://192.168.1.50:11434',
    ];
    for (const host of hosts) {
      calls = 0;
      await expectThrow(
        () => moduleChat([{ role: 'user', content: 'hi' }], { host, model: 'paid', allowPaidApis: true }),
        /Paid\/cloud|paid provider|non-local/i,
        `refuse ${host} without the env flag`,
      );
      expect(calls === 0, `${host} fetched ${calls}`);
    }

    process.env.JEWBOT_ALLOW_PAID = '1';
    calls = 0;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      calls += 1;
      expect(String(input) === 'https://api.x.ai/api/chat', `allowed url ${String(input)}`);
      return new Response(JSON.stringify({ message: { content: 'opened' } }), { status: 200 });
    };
    const opened = await moduleChat([{ role: 'user', content: 'hi' }], {
      host: 'https://api.x.ai',
      model: 'grok',
      allowPaidApis: true,
    });
    expect(opened === 'opened', `flag opened chat (${opened})`);
    expect(calls === 1, 'one allowed fetch');

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: { content: 'local-ok' } }), { status: 200 });
    };
    process.env.JEWBOT_ALLOW_PAID = '0';
    const local = await moduleChat([{ role: 'user', content: 'hi' }], {
      host: 'http://127.0.0.1:11434',
      model: 'qwen2.5-coder:7b',
      allowPaidApis: false,
    });
    expect(local === 'local-ok', `local chat ${local}`);
    expect(calls === 1, 'local chat fetched once');
  } finally {
    globalThis.fetch = original;
    if (savedHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = savedHost;
    if (savedModel === undefined) delete process.env.JEWBOT_MODEL;
    else process.env.JEWBOT_MODEL = savedModel;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testHealth() {
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
    const echo = getModule('echo');
    const fleet = getModule('fleet-triage');
    const muse = getModule('muse');
    expect(!!echo && !!fleet && !!muse, 'echo, fleet, and muse are registered');
    const echoHealth = await echo!.health();
    const fleetHealth = await fleet!.health();
    expect(echoHealth.ok && (echoHealth.detail || '').includes('qwen2.5-coder:7b'), `echo health ${echoHealth.detail}`);
    expect(fleetHealth.ok, 'fleet health ok');
    expect(calls === 2, `echo pings tags itself; fleet uses the shared stub cache (${calls})`);
    const museHealth = await muse!.health();
    expect(museHealth.ok && (museHealth.detail || '').includes('qwen2.5-coder:7b'), `muse health ${museHealth.detail}`);
    expect(calls === 3, `muse pings tags itself (${calls})`);

    const rows = await listModuleHealth();
    const echoRow = rows.find((row) => row.id === 'echo');
    const termRow = rows.find((row) => row.id === 'terminal');
    expect(echoRow?.health === 'ok', 'panel echo ok');
    expect(termRow?.health === 'ok' && termRow.detail === 'loaded', 'terminal is loaded without a model');

    resetOllamaHealthCache();
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('connect ECONNREFUSED');
    };
    const down = await echo!.health();
    expect(down.ok === false, 'down when ollama is unreachable');
    expect((down.detail || '').length > 0, 'down health has a detail');

    resetOllamaHealthCache();
    calls = 0;
    process.env.OLLAMA_HOST = 'https://api.x.ai';
    process.env.JEWBOT_ALLOW_PAID = '0';
    const refused = await echo!.health();
    expect(refused.ok === false, 'stub health refuses x.ai');
    expect(/paid provider|Paid\/cloud|Refusing/i.test(refused.detail || ''), refused.detail || 'no detail');
    expect(calls === 0, `refused stub fetched ${calls}`);

    calls = 0;
    process.env.JEWBOT_ALLOW_PAID = '1';
    process.env.OLLAMA_HOST = 'https://api.openai.com/v1';
    const museRefused = await muse!.health();
    expect(museRefused.ok === false, 'real muse refuses paid even when the flag is set');
    expect(calls === 0, `muse paid fetched ${calls}`);
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

async function main() {
  testRegistry();
  testDiscovery();
  testRealMuse();
  await testBoot();
  await testPaidRefusal();
  await testHealth();
  console.log('smoke-m8: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
