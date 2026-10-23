/**
 * M1 smoke: Ollama client (mocked fetch) + jailed read_file/list_dir + agent loop.
 * No network. No paid APIs.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  assertOllamaAllowed,
  chatOnce,
  chatStream,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  listModels,
  normalizeOllamaHost,
  OllamaConfig,
} from '../src/modules/llm';
import { FileWorkspace } from '../src/modules/files';
import { AgentLoop, parseToolCall } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { defaultTerminal } from '../src/modules/terminal';
import { defaultSshManager } from '../src/modules/ssh';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    expect(re.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

const localCfg: OllamaConfig = {
  host: 'http://127.0.0.1:11434',
  model: 'test-model',
  allowPaidApis: false,
};

function ndjson(parts: string[]): string {
  return parts.map((content) => JSON.stringify({ message: { role: 'assistant', content }, done: false })).join('\n') +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n';
}

async function testOllamaClient() {
  const original = globalThis.fetch;
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  try {
    expect(normalizeOllamaHost('127.0.0.1:11434') === 'http://127.0.0.1:11434', 'host without scheme');
    expect(normalizeOllamaHost('http://localhost:11434/') === 'http://localhost:11434', 'strip slash');
    expect(isLocalOllamaHost('http://127.0.0.1:11434'), 'loopback is local');
    expect(isLocalOllamaHost('http://[::1]:11434'), 'ipv6 loopback is local');
    expect(!isLocalOllamaHost('http://127.0.0.1.evil.com'), 'suffix trick is not local');
    expect(!isLocalOllamaHost('http://localhost.evil.com'), 'localhost suffix trick is not local');
    expect(isPaidProviderHost('https://api.openai.com/v1'), 'openai is paid');
    expect(!isPaidProviderHost('http://127.0.0.1:11434'), 'ollama is not a paid host');

    process.env.OLLAMA_HOST = '192.168.1.9:11434';
    process.env.JEWBOT_MODEL = 'llama3.2';
    process.env.JEWBOT_ALLOW_PAID = '0';
    const cfg = defaultOllamaConfig();
    expect(cfg.host === 'http://192.168.1.9:11434', 'OLLAMA_HOST respected');
    expect(cfg.model === 'llama3.2', 'JEWBOT_MODEL respected');
    expect(cfg.allowPaidApis === false, 'paid flag off');

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('fetch should not run');
    };
    await expectThrow(
      () => listModels({ host: 'https://api.openai.com/v1', model: 'gpt-4o', allowPaidApis: false }),
      /paid provider|Paid\/cloud/i,
      'paid host blocked',
    );
    await expectThrow(
      () => chatOnce([{ role: 'user', content: 'hi' }], { host: 'http://localhost.evil.com', model: 'x', allowPaidApis: false }),
      /non-local|Paid\/cloud/i,
      'lookalike host blocked',
    );
    expect(fetchCalls === 0, 'blocked hosts never fetch');

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      const url = String(input);
      expect(url === 'https://api.openai.com/api/tags', `paid host allowed only the tags URL, got ${url}`);
      expect(init?.method === undefined, 'tags is GET');
      return new Response(JSON.stringify({ models: [{ name: 'gpt-4o' }] }), { status: 200 });
    };
    const paidModels = await listModels({
      host: 'https://api.openai.com',
      model: 'gpt-4o',
      allowPaidApis: true,
    });
    expect(paidModels[0] === 'gpt-4o', 'flag unlocks paid host');

    const tokens: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }, { name: '' }] }), {
          status: 200,
        });
      }
      expect(url === 'http://127.0.0.1:11434/api/chat', `chat url ${url}`);
      expect(init?.method === 'POST', 'chat POST');
      const body = JSON.parse(String(init?.body)) as { model?: string; stream?: boolean; messages?: unknown[] };
      expect(body.model === 'test-model', 'model sent');
      expect(body.stream === true, 'stream flag');
      expect(Array.isArray(body.messages) && body.messages.length === 1, 'messages sent');
      const encoder = new TextEncoder();
      const chunks = [
        '{"message":{"role":"assistant","content":"Hel"}}\n{"message":{"con',
        'tent":"lo"}}\n{"error":""}\n',
      ];
      // The third object has an empty error string which is falsy — ignored.
      // A real error is covered below. Flush path: last line has no extra data.
      void encoder;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(chunks[0]));
          controller.enqueue(encoder.encode(chunks[1]));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    for await (const token of chatStream([{ role: 'user', content: 'hi' }], localCfg)) tokens.push(token);
    expect(tokens.join('') === 'Hello', `streamed tokens ${JSON.stringify(tokens)}`);

    const models = await listModels(localCfg);
    expect(models.length === 1 && models[0] === 'qwen2.5-coder:7b', 'tags parsed');

    globalThis.fetch = async () => new Response('{"message":{"content":"tail"}}', { status: 200 });
    const once = await chatOnce([{ role: 'user', content: 'x' }], localCfg);
    expect(once === 'tail', 'flushes a final NDJSON line without newline');

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'model not found' }) + '\n', { status: 200 });
    await expectThrow(() => chatOnce([{ role: 'user', content: 'x' }], localCfg), /model not found/, 'ollama error field');

    globalThis.fetch = async () => new Response('nope', { status: 500 });
    await expectThrow(() => listModels(localCfg), /500/, 'tags http error');

    const ctrl = new AbortController();
    ctrl.abort();
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted === true, 'abort signal forwarded');
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    await expectThrow(
      () => chatOnce([{ role: 'user', content: 'x' }], localCfg, { signal: ctrl.signal }),
      /cancelled/i,
      'abort surfaces as cancelled',
    );

    assertOllamaAllowed(localCfg);
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

async function testFilesAndAgent() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m1-'));
  try {
    await fs.writeFile(path.join(root, '.gitignore'), 'secret.env\nignored/\n');
    await fs.writeFile(path.join(root, 'hello.txt'), 'hello from jewbot\n');
    await fs.writeFile(path.join(root, 'secret.env'), 'TOKEN=supersecret\n');
    await fs.writeFile(path.join(root, '.env'), 'API_KEY=nope\n');
    await fs.writeFile(path.join(root, '.env.example'), 'API_KEY=\n');
    await fs.mkdir(path.join(root, 'ignored'));
    await fs.writeFile(path.join(root, 'ignored', 'nope.txt'), 'nope');
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'a.txt'), 'nested');
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git', 'config'), 'git');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'pkg.js'), 'x');
    await fs.symlink('/etc/passwd', path.join(root, 'escape.txt'));
    await fs.symlink(path.join(root, 'hello.txt'), path.join(root, 'link-hello.txt'));
    await fs.symlink('/tmp', path.join(root, 'tmp-link'));

    const files = new FileWorkspace(root);
    const listed = await files.listDir('.');
    expect(listed.includes('hello.txt'), 'lists hello.txt');
    expect(listed.includes('sub/'), 'lists sub dir');
    expect(listed.includes('.gitignore'), 'lists gitignore');
    expect(listed.includes('.env.example'), 'keeps .env.example');
    expect(listed.includes('link-hello.txt'), 'lists in-project symlink');
    expect(!listed.includes('secret.env'), 'hides gitignored file');
    expect(!listed.includes('.env'), 'hides .env');
    expect(!listed.includes('ignored/'), 'hides gitignored dir');
    expect(!listed.includes('.git/'), 'hides .git');
    expect(!listed.includes('node_modules/'), 'hides node_modules');
    // The symlink name is visible; reading it must still fail the realpath jail.
    expect(listed.includes('escape.txt'), 'escape symlink name is visible');

    expect((await files.read('hello.txt')) === 'hello from jewbot\n', 'read hello');
    expect((await files.read('sub/a.txt')) === 'nested', 'read nested');
    expect((await files.read('./link-hello.txt')) === 'hello from jewbot\n', 'read in-project symlink');
    expect((await files.listDir('sub')).join(',') === 'a.txt', 'list nested');

    await expectThrow(() => files.read('secret.env'), /gitignored|secret/i, 'gitignore blocks read');
    await expectThrow(() => files.read('.env'), /gitignored|secret/i, 'always-ignore .env');
    await expectThrow(() => files.read('../etc/passwd'), /escapes project root/i, 'lexical jail');
    await expectThrow(() => files.read('/etc/passwd'), /escapes project root/i, 'absolute jail');
    await expectThrow(() => files.read('escape.txt'), /escapes project root/i, 'symlink jail');
    await expectThrow(() => files.listDir('tmp-link'), /escapes project root/i, 'dir symlink jail');
    await expectThrow(() => files.listDir('node_modules'), /gitignored/i, 'cannot list node_modules');
    await expectThrow(() => files.read('.'), /requires a file path/i, 'read dir rejected');

    const preview = await files.proposeEdit('notes/todo.md', 'ship m1\n');
    expect(preview.unifiedDiff.includes('ship m1'), 'diff preview');
    await expectThrow(() => files.applyEdit(preview, false), /confirmation/i, 'apply gated');
    await files.applyEdit(preview, true);
    expect((await files.read('notes/todo.md')) === 'ship m1\n', 'confirmed apply');

    expect(parseToolCall('```json\n{"tool":"read_file","args":{"path":"hello.txt"}}\n```')?.name === 'read_file', 'fenced tool');
    expect(parseToolCall('nope') === null, 'no tool');

    const script = [
      '{"tool":"list_dir","args":{"path":"."}}',
      '{"tool":"read_file","args":{"path":"hello.txt"}}',
      'FINAL: the file says hello from jewbot',
    ];
    let step = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      const content = script[Math.min(step, script.length - 1)];
      step += 1;
      return new Response(ndjson([content]), { status: 200 });
    };
    try {
      const agent = new AgentLoop({
        files,
        terminal: defaultTerminal,
        ssh: defaultSshManager,
        context: new ContextIndexer(root),
        llm: localCfg,
        maxSteps: 6,
      });
      const result = await agent.run('List the project and read hello.txt');
      expect(result.status === 'done', `agent status ${result.status} ${result.blockReason ?? ''}`);
      expect(result.finalText === 'the file says hello from jewbot', `final ${result.finalText}`);
      const tools = result.steps.map((s) => s.tool?.name).filter(Boolean);
      expect(tools[0] === 'list_dir' && tools[1] === 'read_file', `tools ${tools.join(',')}`);
      const listedObs = result.steps[0].observation || '';
      expect(listedObs.includes('hello.txt'), 'agent observed hello.txt');
      expect(!listedObs.includes('secret.env'), 'agent listing hid secret.env');
      expect((result.steps[1].observation || '').includes('hello from jewbot'), 'agent read file contents');
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  await testOllamaClient();
  await testFilesAndAgent();
  console.log('smoke-m1: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
