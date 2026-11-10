/**
 * TwinRent smoke. Mocked Ollama. No rental platform. No live model.
 * Checklist stays local. Drafts use 127.0.0.1:11434 only.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as modules from '../src/modules';
import {
  assertTwinrentLocal,
  isSensitiveListingFacts,
  jewbotModule,
  listSteps,
  markStep,
  nextFreeStep,
  TWINRENT_HOST,
  TWINRENT_STEP_IDS,
  twinrentDraft,
  twinrentHealth,
} from '../src/modules/twinrent';

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

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-twinrent-'));
}

function testModuleShape() {
  expect(jewbotModule.id === 'twinrent', 'module id');
  expect(jewbotModule.version === '0.2.0', 'version');
  expect(jewbotModule.capabilities.includes('local-only'), 'local-only capability');
  expect(!jewbotModule.capabilities.includes('stub'), 'stub capability is gone');
  const names = (jewbotModule.tools || []).map((tool) => tool.name);
  expect(names.join() === 'twinrent_list,twinrent_next,twinrent_mark,twinrent_draft', `tools ${names.join()}`);
  expect(typeof modules.twinrent.twinrentDraft === 'function', 'barrel exports twinrentDraft');
  expect(modules.twinrent.jewbotModule.id === 'twinrent', 'barrel exports the module');
  expect(isSensitiveListingFacts('record my keystrokes') === true, 'keystroke facts are sensitive');
  expect(isSensitiveListingFacts('2 bed, $1400, available June 1') === false, 'unit facts are not sensitive');
}

function testReadmeAndSources() {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'twinrent');
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  expect(readme.includes('127.0.0.1:11434'), 'readme documents the local host');
  expect(readme.includes('/api/tags'), 'readme documents the tags ping');
  expect(readme.includes('assertLocalSpendOnly'), 'readme documents the spend gate');
  expect(/keystroke/i.test(readme), 'readme refuses keystrokes');
  expect(/credential/i.test(readme), 'readme refuses credentials');
  expect(/does not publish/i.test(readme) || /do not publish/i.test(readme) || /Does not publish/i.test(readme) || readme.includes('does not post'), 'readme says it does not publish');
  const banned = ['keydown', 'robotjs', 'puppeteer', 'playwright', 'openai.com', 'api.x.ai'];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8').toLowerCase();
    for (const needle of banned) expect(!text.includes(needle), `${file} contains ${needle}`);
  }
  const localSrc = fs.readFileSync(path.join(dir, 'local.ts'), 'utf8');
  expect(localSrc.includes('assertLocalSpendOnly'), 'twinrent calls assertLocalSpendOnly');
  expect(localSrc.includes("from '../llm/ollama'"), 'twinrent uses src/modules/llm/ollama.ts');
  const gateFn = localSrc.slice(localSrc.indexOf('export function assertTwinrentLocal'));
  const healthFn = localSrc.slice(localSrc.indexOf('export async function twinrentHealth'));
  const draftFn = localSrc.slice(localSrc.indexOf('export async function twinrentDraft'));
  expect(gateFn.indexOf('assertLocalSpendOnly') < gateFn.indexOf('assertOllamaAllowed'), 'spend gate runs before assertOllamaAllowed');
  expect(healthFn.indexOf('assertTwinrentLocal') < healthFn.indexOf('probeOllama'), 'health asserts before the tags ping');
  expect(draftFn.indexOf('assertTwinrentLocal') < draftFn.indexOf('chatOnce'), 'draft asserts before chatOnce');
  expect(!fs.readFileSync(path.join(dir, 'index.ts'), 'utf8').includes('migrationStub'), 'index is not the stub');
}

function testChecklist() {
  const root = tempRoot();
  const listed = listSteps(root);
  expect(listed.source === 'bundled', 'missing file uses the bundle');
  expect(listed.steps.map((step) => step.id).join() === TWINRENT_STEP_IDS.join(), 'step order');
  expect(listed.steps.find((step) => step.id === 'publish')?.status === 'blocked', 'publish starts blocked');
  const next = nextFreeStep(root);
  expect(next.step?.id === 'unit-facts', `next ${next.step?.id}`);
  const marked = markStep('unit-facts', 'done', root);
  expect(marked.published === false, 'mark does not publish');
  expect(marked.step.status === 'done', 'unit facts marked done');
  const file = path.join(root, '.jewbot', 'twinrent-plan.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { steps: Array<{ id: string; status: string; title?: string }> };
  expect(stored.steps.every((step) => step.title === undefined), 'plan file stores no titles or notes');
  expect(!JSON.stringify(stored).toLowerCase().includes('password'), 'plan file has no secret field');
  expect(nextFreeStep(root).step?.id === 'listing-note', 'next advances');
  const before = fs.readFileSync(file, 'utf8');
  expectThrow(() => markStep('publish', 'done', root), /does not publish/, 'publish cannot be marked done');
  expect(fs.readFileSync(file, 'utf8') === before, 'refused publish mark left the file untouched');
  fs.writeFileSync(file, '{');
  expectThrow(() => listSteps(root), /not valid JSON/, 'corrupt plan throws');
  expect(fs.readFileSync(file, 'utf8') === '{', 'corrupt plan was left untouched');

  const outside = tempRoot();
  const linked = tempRoot();
  fs.symlinkSync(outside, path.join(linked, '.jewbot'));
  expectThrow(() => markStep('listing-note', 'done', linked), /symlink/i, 'symlinked .jewbot is refused');
  expect(!fs.existsSync(path.join(outside, 'twinrent-plan.json')), 'symlink refusal did not write outside');
}

async function testRefusesPaidHosts() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  try {
    process.env.JEWBOT_ALLOW_PAID = '1';
    const hosts = [
      'https://api.openai.com/v1',
      'https://api.anthropic.com',
      'https://api.x.ai',
      'https://api.grok.com',
      'http://192.168.1.9:11434',
    ];
    for (const host of hosts) {
      fetches = 0;
      const health = await twinrentHealth({ host, model: 'x' });
      expect(health.ok === false, `health ${host} should be down`);
      expect(/Paid\/cloud|Refusing/i.test(health.detail || ''), health.detail || `health ${host}`);
      await expectThrow(
        () => twinrentDraft('2 bed, $1400, available June 1', { host, model: 'x', allowPaidApis: true }),
        /Paid\/cloud|Refusing/i,
        `draft ${host}`,
      );
      await expectThrow(() => assertTwinrentLocal({ host, model: 'x', allowPaidApis: true }), /Refusing/, `gate ${host}`);
      expect(fetches === 0, `${host} fetched ${fetches}`);
    }
  } finally {
    globalThis.fetch = original;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testDraftUsesLocalOllama() {
  const original = globalThis.fetch;
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  delete process.env.OLLAMA_HOST;
  process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(url === `${TWINRENT_HOST}/api/chat`, `chat url ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; messages?: Array<{ content?: string }> };
    expect(body.model === 'qwen2.5-coder:7b', `model ${body.model}`);
    const blob = (body.messages || []).map((message) => message.content || '').join('\n');
    expect(/do not say the listing was published/i.test(blob), 'system prompt forbids publishing');
    expect(blob.includes('2 bed'), 'facts are sent');
    return new Response(ndjson('Sunny 2-bedroom. Available June 1. $1400.'), { status: 200 });
  };
  try {
    const draft = await twinrentDraft('2 bed, $1400, available June 1');
    expect(draft.refused === false, 'unit facts are drafted');
    expect(draft.published === false, 'draft is not published');
    expect(draft.host === TWINRENT_HOST, `host ${draft.host}`);
    expect(draft.answer.includes('2-bedroom'), `answer ${draft.answer}`);
    expect(calls.length === 1, `chat calls ${calls.join(',')}`);
  } finally {
    globalThis.fetch = original;
    if (savedHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = savedHost;
    if (savedModel === undefined) delete process.env.JEWBOT_MODEL;
    else process.env.JEWBOT_MODEL = savedModel;
  }
}

async function testSensitiveNeverFetches() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  try {
    const samples = [
      'Capture my keystrokes while I type the listing.',
      'Use API key sk-live and password hunter2.',
      'Tenant email ada@example.com',
      'Call the tenant at 404-555-0100',
    ];
    for (const facts of samples) {
      fetches = 0;
      const draft = await twinrentDraft(facts);
      expect(draft.refused === true, `refused ${facts}`);
      expect(draft.published === false, 'refused draft is not published');
      expect(/credentials, keystrokes, or tenant contacts/i.test(draft.answer), draft.answer);
      expect(fetches === 0, `${facts} fetched ${fetches}`);
    }
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
    delete process.env.OLLAMA_HOST;
    process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
    process.env.JEWBOT_ALLOW_PAID = '1';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      calls += 1;
      expect(String(input) === `${TWINRENT_HOST}/api/tags`, `tags url ${String(input)}`);
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 });
    };
    const health = await jewbotModule.health();
    expect(health.ok === true, health.detail || 'health failed');
    expect((health.detail || '').includes('qwen2.5-coder:7b'), `detail ${health.detail}`);
    expect(calls === 1, `tags ping count ${calls}`);

    calls = 0;
    process.env.OLLAMA_HOST = 'https://api.x.ai';
    const refused = await jewbotModule.health();
    expect(refused.ok === false, 'paid host health is down');
    expect(/Paid\/cloud|Refusing/i.test(refused.detail || ''), refused.detail || 'missing detail');
    expect(calls === 0, `paid health fetched ${calls}`);
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

async function main() {
  testModuleShape();
  testReadmeAndSources();
  testChecklist();
  await testRefusesPaidHosts();
  await testDraftUsesLocalOllama();
  await testSensitiveNeverFetches();
  await testHealthPing();
  console.log('smoke-twinrent: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
