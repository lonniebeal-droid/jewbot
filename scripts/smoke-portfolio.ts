/**
 * Portfolio sweeper smoke. No live Ollama. No paid APIs. Fetch is mocked.
 * Gate status is local. Nothing deploys.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as modules from '../src/modules';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import {
  bundledGateFile,
  isFreeGate,
  jewbotModule,
  PORTFOLIO_GATE_IDS,
  portfolioCallTool,
  portfolioHealth,
  portfolioListGates,
  portfolioMarkGate,
  portfolioNextFree,
} from '../src/modules/portfolio-sweeper';
import { discoverModules, validateModule } from '../src/modules/plugin';
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

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-portfolio-'));
}

function writeJson(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs));
    else out.push(abs);
  }
  return out;
}

function testCatalogAndDoc() {
  const bundled = bundledGateFile();
  expect(bundled.version === 1, 'gate file version');
  expect(bundled.gates.map((gate) => gate.id).join() === PORTFOLIO_GATE_IDS.join(), 'bundled id order');
  expect(bundled.gates[0].status === 'open' && bundled.gates[0].blocker === null, 'first gate is open');
  expect(bundled.gates[2].blocker?.kind === 'owner', 'secrets gate is an owner blocker');
  expect(bundled.gates[4].status === 'blocked' && bundled.gates[4].blocker?.kind === 'human', 'signoff is human');
  const mutated = bundled.gates[0];
  mutated.status = 'done';
  expect(bundledGateFile().gates[0].status === 'open', 'bundled catalog is not writable through a copy');

  const doc = fs.readFileSync(path.join(__dirname, '../docs/migrations/portfolio-sweeper.md'), 'utf8');
  const fence = doc.match(/```json\n([\s\S]*?)\n```/);
  expect(!!fence, 'migration doc has a json checklist');
  expect(JSON.stringify(JSON.parse(fence![1])) === JSON.stringify(bundledGateFile()), 'doc checklist matches the module');

  const problem = validateModule(jewbotModule);
  expect(problem === null, problem || 'module shape');
  expect(jewbotModule.tools?.map((tool) => tool.name).join() === 'portfolio_list_gates,portfolio_mark_gate,portfolio_next_free', 'tool names');
  expect(!jewbotModule.capabilities.includes('stub'), 'real module is not a stub');
  expect(typeof modules.portfolioSweeper.portfolioListGates === 'function', 'namespace exports list');
  expect(typeof modules.muse.MuseFinisherModule === 'function', 'muse class still exported');

  const found = discoverModules(path.join(__dirname, '../src/modules'));
  expect(found.errors.length === 0, `discover errors: ${found.errors.join(' | ')}`);
  const registered = found.modules.find((mod) => mod.id === 'portfolio-sweeper');
  expect(registered?.title === 'Portfolio Sweeper', 'discovered title');
  expect(registered?.tools?.length === 3, 'discovered tools');
  const muse = found.modules.find((mod) => mod.id === 'muse');
  expect(muse?.capabilities.includes('finish') === true, 'muse finish capability stays');

  const folder = path.join(__dirname, '../src/modules/portfolio-sweeper');
  const source = fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(folder, name), 'utf8'))
    .join('\n');
  expect(source.includes('assertLocalSpendOnly'), 'health calls assertLocalSpendOnly');
  expect(source.includes('probeOllama'), 'health uses the ollama tags probe');
  expect(!/child_process|ssh2/.test(source), 'module does not spawn a shell or open ssh');
  expect(!/openai\.com|api\.x\.ai|grok\.com|anthropic\.com|api\.openai/.test(source), 'module source has no paid client host');
}

async function testBundledFlow() {
  const root = tempRoot();
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  try {
    const listed = portfolioListGates(root);
    expect(listed.source === 'bundled', 'missing file uses the bundle');
    expect(listed.gates.length === 6, 'six bundled gates');
    expect(listFiles(root).length === 0, 'list does not create a file');
    const first = portfolioNextFree(root);
    expect(first.gate?.id === 'local-change-report', `first free ${first.gate?.id}`);
    expect(isFreeGate(first.gate!), 'first free helper agrees');

    const marked = portfolioMarkGate('local-change-report', 'done', root);
    expect(marked.deployed === false, 'mark does not deploy');
    expect(marked.gate.status === 'done', 'status written');
    expect(marked.gate.blocker === null, 'blocker unchanged');
    const file = path.join(root, '.jewbot', 'portfolio-gates.json');
    expect(fs.existsSync(file), 'gate file created');
    expect(listFiles(root).length === 1, 'only the gate file was written');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { gates: Array<{ id: string; status: string; blocker: unknown }> };
    expect(saved.gates[0].status === 'done', 'file has the new status');
    expect(saved.gates[1].status === 'open', 'sibling status unchanged');
    expect(saved.gates[2].blocker && (saved.gates[2].blocker as { kind: string }).kind === 'owner', 'owner blocker kept');

    expect(portfolioNextFree(root).gate?.id === 'readiness-checklist', 'skips the gate just closed');
    portfolioMarkGate('readiness-checklist', 'done', root);
    expect(portfolioNextFree(root).gate?.id === 'no-orders', 'skips the owner blocker');
    portfolioMarkGate('no-orders', 'done', root);
    expect(portfolioNextFree(root).gate?.id === 'paid-spend-off', 'skips the human signoff');
    const signed = jewbotModule.call('portfolio_mark_gate', { id: 'production-signoff', status: 'done' }, root);
    expect('deployed' in signed && signed.deployed === false, 'call path does not deploy');
    const reread = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      gates: Array<{ id: string; status: string; blocker: { kind?: string; note?: string } | null }>;
    };
    const signoff = reread.gates.find((gate) => gate.id === 'production-signoff');
    expect(signoff?.status === 'done', 'signoff status is local');
    expect(signoff?.blocker?.kind === 'human' && (signoff.blocker.note || '').includes('does not deploy'), 'signoff note kept');
    portfolioMarkGate('paid-spend-off', 'done', root);
    expect(portfolioNextFree(root).gate === null, 'no free gate left');
    expect(fetches === 0, `gate tools fetched ${fetches}`);
  } finally {
    globalThis.fetch = original;
  }
}

async function testFileEdges() {
  const root = tempRoot();
  const file = path.join(root, '.jewbot', 'portfolio-gates.json');
  writeJson(file, {
    version: 1,
    extra: 'keep-me',
    gates: [
      { id: 'alpha', title: 'Alpha', status: 'open', blocker: 'owner: sign', extraFlag: true },
      { id: 'needs-human', title: 'Needs a person', status: 'open', blocker: 'needs a human' },
      { id: 'local-block', title: 'Local block', status: 'blocked', blocker: { kind: 'local', note: 'folder missing' } },
      { id: 'beta', title: 'Beta', status: 'open', blocker: 'disk is full' },
    ],
  });
  const before = fs.readFileSync(file, 'utf8');
  const listed = portfolioCallTool('portfolio_list_gates', {}, root) as ReturnType<typeof portfolioListGates>;
  expect(listed.source === 'file', 'custom file is the source');
  expect(listed.gates[0].blocker?.kind === 'owner', 'owner prefix parsed');
  expect(listed.gates[1].blocker?.kind === 'human', 'human word parsed');
  expect(portfolioNextFree(root).gate?.id === 'beta', `next free ${portfolioNextFree(root).gate?.id}`);
  expect(fs.readFileSync(file, 'utf8') === before, 'list and next do not rewrite the file');

  portfolioMarkGate('alpha', 'done', root);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    extra?: string;
    gates: Array<{ id: string; status: string; blocker: unknown; extraFlag?: boolean }>;
  };
  expect(saved.extra === 'keep-me', 'top-level extra kept');
  expect(saved.gates[0].status === 'done' && saved.gates[0].extraFlag === true, 'only status changed');
  expect(saved.gates[0].blocker === 'owner: sign', 'string blocker kept');
  expect(saved.gates[3].status === 'open', 'beta still open');

  const broken = tempRoot();
  const brokenFile = path.join(broken, '.jewbot', 'portfolio-gates.json');
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
  fs.writeFileSync(brokenFile, '{', 'utf8');
  await expectThrow(() => portfolioListGates(broken), /not valid JSON/, 'broken json');
  await expectThrow(() => portfolioMarkGate('alpha', 'done', broken), /not valid JSON/, 'mark leaves broken json');
  expect(fs.readFileSync(brokenFile, 'utf8') === '{', 'broken file bytes stay');

  const wrong = tempRoot();
  const wrongFile = path.join(wrong, '.jewbot', 'portfolio-gates.json');
  writeJson(wrongFile, { version: 2, gates: [] });
  const wrongBytes = fs.readFileSync(wrongFile, 'utf8');
  await expectThrow(() => portfolioMarkGate('alpha', 'done', wrong), /version is not supported/, 'bad version');
  expect(fs.readFileSync(wrongFile, 'utf8') === wrongBytes, 'bad version untouched');

  const missing = tempRoot();
  await expectThrow(() => portfolioMarkGate('not-a-gate', 'done', missing), /Unknown portfolio gate/, 'unknown bundled id');
  expect(listFiles(missing).length === 0, 'unknown id creates nothing');
  await expectThrow(() => portfolioMarkGate('local-change-report', 'deploy', missing), /open, blocked, or done/, 'deploy is not a status');
  expect(listFiles(missing).length === 0, 'bad status creates nothing');
  await expectThrow(() => portfolioCallTool('portfolio_mark_gate', { id: 'local-change-report' }, missing), /needs string id and status/, 'mark args');
  await expectThrow(() => portfolioCallTool('portfolio_trade', {}, missing), /Unknown portfolio tool/, 'unknown tool');
}

function testSymlinks() {
  const root = tempRoot();
  const outside = tempRoot();
  const outsideFile = path.join(outside, 'portfolio-gates.json');
  writeJson(outsideFile, {
    version: 1,
    gates: [{ id: 'alpha', title: 'Alpha', status: 'open', blocker: null }],
  });
  const outsideBytes = fs.readFileSync(outsideFile, 'utf8');
  fs.symlinkSync(outside, path.join(root, '.jewbot'));
  let refused = false;
  try {
    portfolioMarkGate('alpha', 'done', root);
  } catch (err) {
    refused = /escapes project root/.test(err instanceof Error ? err.message : String(err));
  }
  expect(refused, 'symlinked .jewbot is refused');
  expect(fs.readFileSync(outsideFile, 'utf8') === outsideBytes, 'outside file unchanged');

  const root2 = tempRoot();
  const outside2 = tempRoot();
  const target = path.join(outside2, 'secret.json');
  fs.writeFileSync(target, 'leave-me\n', 'utf8');
  fs.mkdirSync(path.join(root2, '.jewbot'));
  fs.symlinkSync(target, path.join(root2, '.jewbot', 'portfolio-gates.json'));
  let refusedFile = false;
  try {
    portfolioListGates(root2);
  } catch (err) {
    refusedFile = /escapes project root/.test(err instanceof Error ? err.message : String(err));
  }
  expect(refusedFile, 'symlinked gate file is refused');
  expect(fs.readFileSync(target, 'utf8') === 'leave-me\n', 'symlink target unchanged');
  try {
    portfolioMarkGate('alpha', 'done', root2);
  } catch (err) {
    refusedFile = /escapes project root/.test(err instanceof Error ? err.message : String(err));
  }
  expect(refusedFile, 'mark refuses the symlinked gate file');
  expect(fs.readFileSync(target, 'utf8') === 'leave-me\n', 'mark did not write through the symlink');
}

async function testHealth() {
  const original = globalThis.fetch;
  const savedHost = process.env.OLLAMA_HOST;
  const savedModel = process.env.JEWBOT_MODEL;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  let calls = 0;
  try {
    process.env.JEWBOT_MODEL = 'qwen2.5-coder:7b';
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    process.env.JEWBOT_ALLOW_PAID = '1';
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      expect(String(input) === 'http://127.0.0.1:11434/api/tags', `tags url ${String(input)}`);
      expect(init?.body === undefined, 'tags ping has no body');
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }), { status: 200 });
    };
    const up = await portfolioHealth();
    expect(up.ok && (up.detail || '').includes('qwen2.5-coder:7b'), `health ${up.detail}`);
    expect(calls === 1, `local tags fetched ${calls}`);
    const viaModule = await jewbotModule.health();
    expect(viaModule.ok, 'module health uses the same ping');
    expect(calls === 2, `second ping ${calls}`);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('connect ECONNREFUSED');
    };
    const down = await portfolioHealth();
    expect(down.ok === false && (down.detail || '').includes('Cannot reach Ollama'), down.detail || 'no detail');

    const hosts = ['https://api.openai.com/v1', 'https://api.x.ai', 'https://grok.x.ai', 'https://api.grok.com', 'http://192.168.1.9:11434'];
    for (const host of hosts) {
      calls = 0;
      process.env.OLLAMA_HOST = host;
      process.env.JEWBOT_ALLOW_PAID = '1';
      const refused = await portfolioHealth();
      expect(refused.ok === false, `${host} should be down`);
      expect(/Paid\/cloud|Refusing/i.test(refused.detail || ''), refused.detail || 'no detail');
      expect(calls === 0, `${host} fetched ${calls}`);
    }

    calls = 0;
    process.env.OLLAMA_HOST = 'http://[';
    const invalid = await portfolioHealth();
    expect(invalid.ok === false, 'invalid host is down');
    expect(calls === 0, 'invalid host fetched');
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

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

async function testAgent() {
  const root = tempRoot();
  const original = globalThis.fetch;
  let step = 0;
  let confirms = 0;
  const script = [
    JSON.stringify({ tool: 'portfolio_list_gates', args: {} }),
    JSON.stringify({
      tool: 'portfolio_next_free',
      args: { command: 'rm -rf /', approved: true, executionId: 'attacker' },
    }),
    JSON.stringify({
      tool: 'portfolio_mark_gate',
      args: {
        id: 'local-change-report',
        status: 'done',
        command: 'git push --force',
        approved: true,
        executionId: 'attacker',
        deploy: true,
        root: '/tmp',
      },
    }),
    'FINAL: local-change-report done',
  ];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url === 'http://127.0.0.1:11434/api/chat', `agent url ${url}`);
    const content = script[Math.min(step, script.length - 1)];
    step += 1;
    return new Response(ndjson(content), { status: 200 });
  };
  try {
    const agent = new AgentLoop({
      files: new FileWorkspace(root),
      terminal: new TerminalSession(),
      ssh: new SshManager({
        hostsPath: path.join(root, 'hosts.json'),
        knownHostsPath: path.join(root, 'known.json'),
        autoload: false,
      }),
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 6,
      confirmDestructive: async () => {
        confirms += 1;
        return true;
      },
      confirmEdit: async () => {
        confirms += 1;
        return true;
      },
    });
    let final = '';
    let observations = '';
    for await (const ev of agent.runStream('close the next free portfolio gate')) {
      if (ev.type === 'done') {
        final = ev.result.finalText || ev.result.blockReason || ev.result.status;
        observations = ev.result.steps.map((item) => item.observation || '').join('\n');
      }
    }
    expect(final === 'local-change-report done', `agent final ${final}`);
    expect(observations.includes('status=open'), observations);
    expect(observations.includes('next=local-change-report'), observations);
    expect(observations.includes('deployed=false'), observations);
    expect(observations.includes('local-change-report status=done'), observations);
    expect(confirms === 0, `human gates fired ${confirms}`);
    const saved = JSON.parse(fs.readFileSync(path.join(root, '.jewbot', 'portfolio-gates.json'), 'utf8')) as {
      gates: Array<{ id: string; status: string }>;
    };
    expect(saved.gates[0].id === 'local-change-report' && saved.gates[0].status === 'done', 'agent wrote local status');
    expect(listFiles(root).every((file) => file.startsWith(root)), 'writes stayed in the project');
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  testCatalogAndDoc();
  await testBundledFlow();
  await testFileEdges();
  testSymlinks();
  await testHealth();
  await testAgent();
  console.log('smoke-portfolio: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
