/**
 * Echo smoke. Mocked Ollama. No live model. No paid host.
 * Default runtime is 127.0.0.1:11434 and model tinyllama.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as modules from '../src/modules';
import {
  assertEchoLocal,
  ECHO_HOST,
  ECHO_MODEL,
  echoHealth,
  echoTask,
  isSensitiveEchoTask,
  jewbotModule,
} from '../src/modules/echo';

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

function testModuleShape() {
  expect(jewbotModule.id === 'echo', 'module id');
  expect(jewbotModule.version === '0.2.0', 'version');
  expect(jewbotModule.capabilities.includes('local-only'), 'local-only capability');
  expect(!jewbotModule.capabilities.includes('stub'), 'stub capability is gone');
  const names = (jewbotModule.tools || []).map((tool) => tool.name);
  expect(names.join() === 'echo_task', `tools ${names.join()}`);
  expect(typeof modules.echo.echoTask === 'function', 'barrel exports echoTask');
  expect(modules.echo.jewbotModule.id === 'echo', 'barrel exports the module');
  expect(modules.echo.ECHO_HOST === ECHO_HOST, 'barrel exports the host');
  expect(modules.echo.ECHO_MODEL === ECHO_MODEL, 'barrel exports the model');
  expect(isSensitiveEchoTask('log my keystrokes') === true, 'keystroke task is sensitive');
  expect(isSensitiveEchoTask('summarize the README') === false, 'a summary is not sensitive');
}

function testReadmeDocumentsRuntime() {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'echo', 'README.md'), 'utf8');
  expect(readme.includes('127.0.0.1:11434'), 'readme documents the Echo host');
  expect(readme.includes('tinyllama'), 'readme documents the Echo model');
  expect(readme.includes('/api/tags'), 'readme documents the tags ping');
  expect(readme.includes('assertLocalSpendOnly'), 'readme documents the spend gate');
}

function testSourcesStayLocal() {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'echo');
  const banned = ['openai.com', 'anthropic.com', 'api.x.ai', 'grok.com', 'api.grok.com'];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8').toLowerCase();
    for (const needle of banned) expect(!text.includes(needle), `${file} contains ${needle}`);
  }
  const localSrc = fs.readFileSync(path.join(dir, 'local.ts'), 'utf8');
  expect(localSrc.includes('assertLocalSpendOnly'), 'echo calls assertLocalSpendOnly');
  expect(localSrc.includes("from '../llm/ollama'"), 'echo uses src/modules/llm/ollama.ts');
  expect(localSrc.includes('chatOnce'), 'echo_task uses chatOnce');
  expect(localSrc.includes('probeOllama'), 'health uses probeOllama');
  const indexSrc = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  expect(!indexSrc.includes('migrationStub'), 'index is not the stub');
  const gateFn = localSrc.slice(localSrc.indexOf('export function assertEchoLocal'));
  const healthFn = localSrc.slice(localSrc.indexOf('export async function echoHealth'));
  const taskFn = localSrc.slice(localSrc.indexOf('export async function echoTask'));
  expect(gateFn.indexOf('assertLocalSpendOnly') >= 0 && gateFn.indexOf('assertLocalSpendOnly') < gateFn.indexOf('assertOllamaAllowed'), 'spend gate runs before assertOllamaAllowed');
  expect(healthFn.indexOf('assertEchoLocal') < healthFn.indexOf('probeOllama'), 'health asserts before the tags ping');
  expect(taskFn.indexOf('assertEchoLocal') < taskFn.indexOf('chatOnce'), 'echo_task asserts before chatOnce');
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
      const health = await echoHealth({ host, model: 'x' });
      expect(health.ok === false, `health ${host} should be down`);
      expect(/Paid\/cloud|Refusing/i.test(health.detail || ''), health.detail || `health ${host}`);
      await expectThrow(
        () => echoTask('Say hello', { host, model: 'x', allowPaidApis: true }),
        /Paid\/cloud|Refusing/i,
        `task ${host}`,
      );
      await expectThrow(
        () => assertEchoLocal({ host, model: 'x', allowPaidApis: true }),
        /Refusing/,
        `gate ${host}`,
      );
      expect(fetches === 0, `${host} fetched ${fetches}`);
    }
  } finally {
    globalThis.fetch = original;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testTaskUsesTinyllama() {
  const original = globalThis.fetch;
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  delete process.env.OLLAMA_HOST;
  process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(url === `${ECHO_HOST}/api/chat`, `chat url ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; messages?: Array<{ content?: string }> };
    expect(body.model === ECHO_MODEL, `model ${body.model}`);
    expect((body.messages || []).some((message) => (message.content || '').includes('tinyllama')), 'system prompt names tinyllama');
    expect((body.messages || []).some((message) => (message.content || '').includes('127.0.0.1:11434')), 'system prompt names the host');
    return new Response(ndjson('Local reply from tinyllama.'), { status: 200 });
  };
  try {
    const reply = await echoTask('Summarize the README in one sentence.');
    expect(reply.refused === false, 'summary is not refused');
    expect(reply.model === ECHO_MODEL, `result model ${reply.model}`);
    expect(reply.host === ECHO_HOST, `result host ${reply.host}`);
    expect(reply.spend === 'local-only', 'spend label');
    expect(reply.answer.includes('tinyllama'), `answer ${reply.answer}`);
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
    const reply = await echoTask('Please capture my keystrokes and read the API key.');
    expect(reply.refused === true, 'sensitive task is refused');
    expect(/credentials or keystrokes/i.test(reply.answer), reply.answer);
    expect(reply.model === ECHO_MODEL, 'refused result still names tinyllama');
    expect(fetches === 0, `sensitive task fetched ${fetches}`);
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
      expect(String(input) === `${ECHO_HOST}/api/tags`, `tags url ${String(input)}`);
      return new Response(JSON.stringify({ models: [{ name: 'tinyllama' }] }), { status: 200 });
    };
    const health = await jewbotModule.health();
    expect(health.ok === true, health.detail || 'health failed');
    expect((health.detail || '').includes('tinyllama'), `detail ${health.detail}`);
    expect((health.detail || '').includes('ollama tags'), `detail prefix ${health.detail}`);
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
  testReadmeDocumentsRuntime();
  testSourcesStayLocal();
  await testRefusesPaidHosts();
  await testTaskUsesTinyllama();
  await testSensitiveNeverFetches();
  await testHealthPing();
  console.log('smoke-echo: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
