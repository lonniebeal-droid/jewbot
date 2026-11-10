/**
 * LAN Ollama routing smoke. Mocked fetch. No live hosts. No paid API.
 * Registry order is the fallback order. Public and paid hosts are not fetched.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertRoutableOllamaHost,
  formatRouteReport,
  hostHasModel,
  hubOllamaHealth,
  inspectOllamaHosts,
  isPrivateOrTailscaleIPv4,
  isRoutableFreeHost,
  jewbotModule,
  loadOllamaHosts,
  parseHostFile,
  routedChatOnce,
} from '../src/modules/llm';

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

function tags(models: string[]): Response {
  return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), { status: 200 });
}

function ndjson(content: string): string {
  return JSON.stringify({ message: { role: 'assistant', content }, done: true }) + '\n';
}

function testAddressClasses() {
  expect(isRoutableFreeHost('http://127.0.0.1:11434'), 'loopback');
  expect(isRoutableFreeHost('http://localhost:11434'), 'localhost');
  expect(isRoutableFreeHost('http://[::1]:11434'), 'ipv6 loopback');
  expect(isPrivateOrTailscaleIPv4('10.1.2.3'), '10/8');
  expect(isPrivateOrTailscaleIPv4('172.16.0.1') && isPrivateOrTailscaleIPv4('172.31.255.1'), '172.16/12');
  expect(!isPrivateOrTailscaleIPv4('172.15.0.1') && !isPrivateOrTailscaleIPv4('172.32.0.1'), 'outside 172.16/12');
  expect(isPrivateOrTailscaleIPv4('192.168.1.20'), '192.168/16');
  expect(isPrivateOrTailscaleIPv4('100.64.0.1') && isPrivateOrTailscaleIPv4('100.127.255.9'), 'tailscale 100.64/10');
  expect(!isPrivateOrTailscaleIPv4('100.63.0.1') && !isPrivateOrTailscaleIPv4('100.128.0.1'), 'public 100.x');
  expect(!isPrivateOrTailscaleIPv4('8.8.8.8'), 'public dns ip');
  expect(isRoutableFreeHost('http://192.168.1.10:11434'), 'lan url');
  expect(isRoutableFreeHost('http://100.64.0.8:11434'), 'tailscale url');
  expect(isRoutableFreeHost('http://[fd7a:115c:a1e0::53]:11434'), 'tailscale ipv6 ula');
  expect(!isRoutableFreeHost('http://8.8.8.8:11434'), 'public ip refused');
  expect(!isRoutableFreeHost('http://0.0.0.0:11434'), 'unspecified address refused');
  expect(!isRoutableFreeHost('https://api.openai.com/v1'), 'paid name refused');
  expect(!isRoutableFreeHost('https://api.x.ai'), 'xai refused');
  expect(!isRoutableFreeHost('http://example.com:11434'), 'public dns name refused');
  expect(!isRoutableFreeHost('http://192.168.1.1.evil.com'), 'dotted suffix is not an address');
  expect(hostHasModel(['tinyllama:latest'], 'tinyllama'), 'tagless request matches tagged model');
  expect(!hostHasModel(['qwen2.5-coder:7b'], 'qwen'), 'short name does not match a different model');
}

function testRegistryParsing() {
  const fromEnv = loadOllamaHosts({
    env: 'mac=http://192.168.1.10:11434,dell=10.1.0.5:11434,pi=http://100.64.0.8:11434,local=127.0.0.1:11434',
    skipFile: true,
  });
  expect(fromEnv.map((host) => host.name).join() === 'mac,dell,pi,local', `env order ${fromEnv.map((h) => h.name).join()}`);
  expect(fromEnv[1].host === 'http://10.1.0.5:11434', 'scheme added');
  expect(loadOllamaHosts({ env: '', skipFile: true })[0].name === 'local', 'empty env falls back to localhost');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-ollama-hosts-'));
  const file = path.join(dir, 'ollama-hosts.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      hosts: [
        { name: 'mac', host: 'http://192.168.1.10:11434' },
        { name: 'pi', url: 'http://100.64.0.8:11434' },
      ],
    }),
  );
  const fromFile = parseHostFile(file);
  expect(fromFile.map((host) => host.name).join() === 'mac,pi', 'file order');
  fs.writeFileSync(file, JSON.stringify({ hosts: [], password: 'nope' }));
  expectThrow(() => parseHostFile(file), /password/, 'secret field rejected');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-ollama-link-'));
  const link = path.join(dir, 'linked.json');
  fs.writeFileSync(path.join(outside, 'real.json'), '{"hosts":[]}');
  fs.symlinkSync(path.join(outside, 'real.json'), link);
  expectThrow(() => parseHostFile(link), /regular file/, 'symlink host file is not read');
}

async function testPickAndRefuse() {
  const original = globalThis.fetch;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  const calls: string[] = [];
  process.env.JEWBOT_ALLOW_PAID = '1';
  const entries = loadOllamaHosts({
    env: 'mac=http://192.168.1.10:11434,dell=http://10.1.0.5:11434,pi=http://100.64.0.8:11434,local=http://127.0.0.1:11434,public=http://8.8.8.8:11434,paid=https://api.openai.com/v1',
    skipFile: true,
  });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('http://192.168.1.10:11434')) throw new Error('connect ECONNREFUSED');
    if (url.startsWith('http://10.1.0.5:11434')) return tags(['other:latest']);
    if (url.startsWith('http://100.64.0.8:11434')) return tags(['tinyllama:latest']);
    if (url.startsWith('http://127.0.0.1:11434')) return tags(['tinyllama:latest', 'qwen2.5-coder:7b']);
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const report = await inspectOllamaHosts({ model: 'tinyllama', entries });
    expect(report.selected?.name === 'pi', `selected ${report.selected?.name}`);
    expect(report.selected?.host === 'http://100.64.0.8:11434', `selected host ${report.selected?.host}`);
    expect(report.hosts.find((host) => host.name === 'mac')?.ok === false, 'down host is not selected');
    expect(report.hosts.find((host) => host.name === 'dell')?.ok === true, 'dell answered tags');
    expect(report.hosts.find((host) => host.name === 'public')?.refused === true, 'public ip refused');
    expect(report.hosts.find((host) => host.name === 'paid')?.refused === true, 'paid host refused');
    expect(!calls.some((url) => url.includes('8.8.8.8') || url.includes('openai.com')), `refused hosts fetched ${calls.join(' ')}`);
    expect(calls.filter((url) => url.endsWith('/api/tags')).length === 4, `probed allowed hosts ${calls.join(' ')}`);
    const detail = formatRouteReport(report);
    expect(detail.includes('selected=pi') && detail.includes('public=refused') && detail.includes('model=tinyllama'), detail);

    calls.length = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/api/tags')) {
        if (url.startsWith('http://192.168.1.10:11434')) return tags(['llama3.2']);
        if (url.startsWith('http://10.1.0.5:11434')) return tags(['tinyllama:latest']);
        return tags([]);
      }
      expect(url === 'http://10.1.0.5:11434/api/chat', `chat url ${url}`);
      expect(init?.method === 'POST', 'chat is POST');
      const body = JSON.parse(String(init?.body)) as { model?: string };
      expect(body.model === 'tinyllama', `chat model ${body.model}`);
      return new Response(ndjson('from dell'), { status: 200 });
    };
    const chat = await routedChatOnce([{ role: 'user', content: 'hi' }], {
      model: 'tinyllama',
      entries: entries.filter((host) => host.name === 'mac' || host.name === 'dell'),
    });
    expect(chat.name === 'dell' && chat.host === 'http://10.1.0.5:11434', `chat pick ${chat.name} ${chat.host}`);
    expect(chat.text === 'from dell', chat.text);
    expect(!calls.some((line) => line.includes('/api/chat') && line.includes('192.168.1.10')), 'chat did not use the host missing the model');
  } finally {
    globalThis.fetch = original;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
  }
}

async function testHubHealth() {
  const original = globalThis.fetch;
  const saved = process.env.JEWBOT_OLLAMA_HOSTS;
  const savedModel = process.env.JEWBOT_MODEL;
  process.env.JEWBOT_OLLAMA_HOSTS = 'mac=http://192.168.1.10:11434,local=http://127.0.0.1:11434';
  process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url.endsWith('/api/tags'), `health fetch ${url}`);
    if (url.startsWith('http://192.168.1.10:11434')) return tags(['qwen2.5-coder:7b']);
    return tags(['tinyllama']);
  };
  try {
    expect(jewbotModule.id === 'llm', 'hub module id');
    const health = await jewbotModule.health();
    expect(health.ok === true, health.detail || 'health not ok');
    expect((health.detail || '').includes('hosts mac=ok,local=ok'), health.detail || 'missing hosts');
    expect((health.detail || '').includes('selected=mac'), health.detail || 'missing selection');
    expect((health.detail || '').includes('model=qwen2.5-coder:7b'), health.detail || 'missing model');
    const same = await hubOllamaHealth();
    expect(same.detail === health.detail, 'module health is the hub report');
    await expectThrow(() => assertRoutableOllamaHost('https://api.x.ai'), /Refusing/, 'gate refuses x.ai');
    await expectThrow(() => assertRoutableOllamaHost('http://100.128.0.1:11434'), /Refusing/, 'gate refuses public 100.x');
  } finally {
    globalThis.fetch = original;
    if (saved === undefined) delete process.env.JEWBOT_OLLAMA_HOSTS;
    else process.env.JEWBOT_OLLAMA_HOSTS = saved;
    if (savedModel === undefined) delete process.env.JEWBOT_MODEL;
    else process.env.JEWBOT_MODEL = savedModel;
  }
}

function testSourceGate() {
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'llm', 'route.ts'), 'utf8');
  const probe = route.slice(route.indexOf('async function probeEntry'));
  expect(route.includes('assertLocalSpendOnly'), 'router calls assertLocalSpendOnly');
  expect(probe.indexOf('assertRoutableOllamaHost') < probe.indexOf('listModels'), 'probe gates before /api/tags');
  expect(!route.includes('sshExec') && !route.includes('ssh_exec') && !route.includes("from '../ssh'"), 'router does not add SSH actions');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  expect(readme.includes('JEWBOT_OLLAMA_HOSTS'), 'readme documents the env list');
  expect(readme.includes('100.64.0.0/10') || readme.includes('100.64/10'), 'readme documents the Tailscale range');
  expect(/private LAN/i.test(readme), 'readme documents private LAN');
}

async function main() {
  testAddressClasses();
  testRegistryParsing();
  testSourceGate();
  await testPickAndRefuse();
  await testHubHealth();
  console.log('smoke-route: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
