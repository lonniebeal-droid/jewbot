/**
 * Muse smoke: five open release blockers, local fleet health + chat, no paid hosts.
 * Fetch is mocked. No OAuth tokens. No destructive ops. No live Ollama.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as modules from '../src/modules';
import {
  assertFleetLocal,
  createFleetClient,
  DEFAULT_FLEET_HOST,
  fleetChat,
  fleetHealth,
  listReleaseBlockers,
  MUSE_BLOCKER_IDS,
  MuseFinisherModule,
  resolveFleetConfig,
  runFinishLine,
} from '../src/modules/muse';

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

const local = { host: DEFAULT_FLEET_HOST, model: 'test-model' };

function testChecklist() {
  const tasks = listReleaseBlockers();
  expect(tasks.length === 5, `expected 5 blockers, got ${tasks.length}`);
  expect(tasks.map((task) => task.id).join() === MUSE_BLOCKER_IDS.join(), 'blocker id order');
  expect(tasks.every((task) => task.status === 'open'), 'catalog tasks stay open');
  expect(tasks[0].prompt.toLowerCase().includes('lovable'), 'private URL rejects the Lovable gateway');
  expect(tasks[0].prompt.toLowerCase().includes('authenticated'), 'private URL is authenticated');
  expect(/gmail/i.test(tasks[1].title) && /calendar/i.test(tasks[1].title), 'gmail and calendar');
  expect(/oauth/i.test(tasks[1].prompt), 'oauth named on the gmail task');
  expect(/token/i.test(tasks[1].prompt), 'tokens stay out of git');
  expect(/end-to-end/i.test(tasks[2].title), 'e2e chat task');
  expect(/supabase/i.test(tasks[3].title) && /rls/i.test(tasks[3].title), 'supabase rls task');
  expect(tasks[4].id.includes('2026-10-16'), 'production gate date');

  const mutated = tasks[0];
  mutated.status = 'done';
  expect(listReleaseBlockers()[0].status === 'open', 'catalog is not writable through a copy');

  const finisher = new MuseFinisherModule(local);
  expect(finisher.blockers().every((task) => task.status === 'open'), 'module blockers stay open');
  expect(typeof modules.muse.runFinishLine === 'function', 'muse namespace exports runFinishLine');
  expect(modules.muse.MuseFinisherModule === MuseFinisherModule, 'muse namespace exports the class');
}

function testConfig() {
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  try {
    delete process.env.OLLAMA_HOST;
    delete process.env.JEWBOT_MODEL;
    process.env.JEWBOT_ALLOW_PAID = '1';
    const defaults = resolveFleetConfig();
    expect(defaults.host === DEFAULT_FLEET_HOST, `default host ${defaults.host}`);
    expect(defaults.model === 'qwen2.5-coder:7b', `default model ${defaults.model}`);
    expect(defaults.allowPaidApis === false, 'muse forces paid off');

    process.env.OLLAMA_HOST = '127.0.0.1:11434';
    process.env.JEWBOT_MODEL = 'llama3.2';
    const fromEnv = resolveFleetConfig();
    expect(fromEnv.host === DEFAULT_FLEET_HOST, `env host ${fromEnv.host}`);
    expect(fromEnv.model === 'llama3.2', `env model ${fromEnv.model}`);
    expect(fromEnv.allowPaidApis === false, 'paid flag cannot opt muse in');

    const explicit = resolveFleetConfig({ host: 'http://localhost:11434/', model: '  custom  ' });
    expect(explicit.host === 'http://localhost:11434', `explicit host ${explicit.host}`);
    expect(explicit.model === 'custom', `explicit model ${explicit.model}`);
  } finally {
    if (savedHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = savedHost;
    if (savedModel === undefined) delete process.env.JEWBOT_MODEL;
    else process.env.JEWBOT_MODEL = savedModel;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testRefusesNonLocal() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  try {
    const paidHost = 'https://api.openai.com/v1';
    const lanHost = 'http://192.168.1.9:11434';
    await expectThrow(() => fleetHealth({ host: paidHost, model: 'x' }), /Paid\/cloud|Refusing/i, 'paid host health');
    await expectThrow(() => fleetChat([{ role: 'user', content: 'hi' }], { host: lanHost, model: 'x' }), /Paid\/cloud|Refusing/i, 'lan chat');
    await expectThrow(
      () => createFleetClient({ host: paidHost, model: 'x', allowPaidApis: true }),
      /Paid\/cloud|Refusing/i,
      'client refuses paid even when the flag is set',
    );
    await expectThrow(() => assertFleetLocal({ host: lanHost, model: 'x', allowPaidApis: true }), /Refusing/, 'allow paid still local-only');
    expect(fetches === 0, `refused hosts fetched ${fetches} times`);

    const report = await runFinishLine({ config: { host: paidHost, model: 'x' }, review: true });
    expect(report.blockers.length === 5, 'refusal still returns the checklist');
    expect(report.blockers.every((task) => task.status === 'open'), 'refusal does not close blockers');
    expect(report.fleet.ok === false, 'refused fleet is not ok');
    expect((report.fleet.error || '').includes('Paid/cloud') || (report.fleet.error || '').includes('Refusing'), report.fleet.error || 'missing error');
    expect(report.summary === undefined, 'refused fleet has no summary');
    expect(fetches === 0, `runFinishLine fetched ${fetches} times for a paid host`);
  } finally {
    globalThis.fetch = original;
  }
}

async function testFleetChat() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const savedToken = process.env.GMAIL_REFRESH_TOKEN;
  process.env.GMAIL_REFRESH_TOKEN = 'must-not-appear-in-muse-traffic';
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const body = String(init?.body ?? '');
    expect(!body.includes('must-not-appear-in-muse-traffic'), 'oauth token must not be sent to the fleet');
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'test-model' }] }), { status: 200 });
    }
    expect(url === `${DEFAULT_FLEET_HOST}/api/chat`, `chat url ${url}`);
    if (body.includes('local Muse finisher')) {
      expect(body.includes('Private authenticated model URL'), 'review names the private URL blocker');
      expect(body.includes('2026-10-16'), 'review names the production gate');
    }
    return new Response(ndjson('All five blockers are done.'), { status: 200 });
  };
  try {
    const client = createFleetClient(local);
    expect(client.config.allowPaidApis === false, 'client config stays unpaid');
    const health = await client.health();
    expect(health.ok === true, health.error || 'health failed');
    expect(health.models.join() === 'test-model', `models ${health.models.join()}`);
    const reply = await client.chat([{ role: 'user', content: 'ping' }]);
    expect(reply === 'All five blockers are done.', `reply ${reply}`);

    const report = await runFinishLine({ config: local });
    expect(report.module === 'muse' && report.spend === 'local-only', 'report labels');
    expect(report.openCount === 5, `open ${report.openCount}`);
    expect(report.blockers.every((task) => task.status === 'open'), 'model text does not close blockers');
    expect(report.summary === 'All five blockers are done.', `summary ${report.summary}`);
    expect(report.fleet.ok === true, report.fleet.error || 'fleet not ok');
    expect(!JSON.stringify(report).includes('must-not-appear-in-muse-traffic'), 'report does not contain the token');

    calls.length = 0;
    const quiet = await new MuseFinisherModule(local).runFinishLine({ review: false });
    expect(quiet.summary === undefined, 'review false skips chat');
    expect(quiet.fleet.ok === true, 'health still runs');
    expect(calls.length === 1 && calls[0].endsWith('/api/tags'), `review false calls ${calls.join(',')}`);
  } finally {
    globalThis.fetch = original;
    if (savedToken === undefined) delete process.env.GMAIL_REFRESH_TOKEN;
    else process.env.GMAIL_REFRESH_TOKEN = savedToken;
  }
}

async function testDownFleet() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  try {
    const report = await runFinishLine({ config: local, review: true });
    expect(report.openCount === 5, 'down fleet still lists blockers');
    expect(report.fleet.ok === false, 'down fleet is not ok');
    expect((report.fleet.error || '').length > 0, 'down fleet explains why');
    expect(report.summary === undefined, 'down fleet has no summary');
    expect(report.blockers.every((task) => task.status === 'open'), 'down fleet does not close blockers');
  } finally {
    globalThis.fetch = original;
  }
}

function testSourcesStayLocal() {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'muse');
  const banned = [
    'openai.com',
    'anthropic.com',
    'api.x.ai',
    'x.ai',
    'cursor.com',
    'cursor.sh',
    'lovable.dev',
    'lovable.app',
    'lovable.ai',
    'googleapis.com',
    'supabase.co',
    'refresh_token',
    'client_secret',
    'ya29.',
  ];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const needle of banned) {
      expect(!text.toLowerCase().includes(needle), `${file} contains ${needle}`);
    }
    expect(text.includes('assertLocalSpendOnly') || file !== 'fleet.ts', 'fleet calls assertLocalSpendOnly');
  }
}

async function main() {
  testChecklist();
  testConfig();
  testSourcesStayLocal();
  await testRefusesNonLocal();
  await testFleetChat();
  await testDownFleet();
  console.log('smoke-muse: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
