/**
 * Street Trader smoke. Mocked Ollama. No broker. No paid host. No live model.
 * Refuses non-local hosts, always returns the disclaimer, and the outline
 * covers the five topic areas.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as modules from '../src/modules';
import {
  assertStreetLocal,
  isLiveOrderRequest,
  jewbotModule,
  sizePosition,
  STREET_DEFAULT_HOST,
  STREET_DISCLAIMER,
  streetAsk,
  streetHealth,
  streetJournalPrompt,
  streetOutline,
  STREET_TOPICS,
} from '../src/modules/street-trader';

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

const local = { host: STREET_DEFAULT_HOST, model: 'test-model' };

function testOutlineCoversFive() {
  const outline = streetOutline();
  expect(outline.tool === 'street_outline', 'outline tool name');
  expect(outline.spend === 'local-only', 'outline is local-only');
  expect(outline.disclaimer === STREET_DISCLAIMER, 'outline disclaimer');
  expect(/not financial advice/i.test(outline.text), 'outline text carries the disclaimer');
  expect(outline.topics.length === 5, `five topics, got ${outline.topics.length}`);
  const blob = `${outline.text}\n${outline.topics.map((topic) => topic.title).join('\n')}`.toLowerCase();
  const areas = ['position sizing', 'risk management', 'chart reading', 'pump-and-dump', 'trading routine'];
  for (const area of areas) expect(blob.includes(area), `outline covers ${area}`);
  expect(outline.topics.map((topic) => topic.id).join() === STREET_TOPICS.map((topic) => topic.id).join(), 'topic order');
  expect(streetOutline('chart-reading').topics.length === 1, 'single topic filter');
  expect(outline.sources.length === 3, 'three owner source links');
  expect(outline.sources.every((source) => source.url.startsWith('https://')), 'sources are links');
}

function testJournal() {
  const all = streetJournalPrompt();
  expect(all.tool === 'street_journal_prompt', 'journal tool name');
  expect(all.writesSheet === false, 'journal does not write the sheet');
  expect(all.disclaimer === STREET_DISCLAIMER, 'journal disclaimer');
  expect(/not financial advice/i.test(all.text), 'journal text carries the disclaimer');
  expect(all.prompts.length === 3, 'trade, session, and week');
  const flat = all.prompts.flatMap((block) => block.prompts).join('\n').toLowerCase();
  expect(flat.includes('paper'), 'journal asks about paper trades');
  expect(flat.includes('followed rules') || flat.includes('followed the rules') || /followed rules/.test(flat), 'journal asks about the rules');
  expect(/2:1|2 to 1/.test(flat) || flat.includes('reward'), 'journal asks about reward-to-risk');
  const trade = streetJournalPrompt('trade');
  expect(trade.prompts.length === 1 && trade.prompts[0].kind === 'trade', 'trade filter');
}

function testSizingFixtures() {
  const a = sizePosition({ account: 1000, entry: 25, stop: 24 });
  const b = sizePosition({ account: 5000, entry: 40, stop: 38.5 });
  const c = sizePosition({ account: 1500, entry: 8, stop: 7.7 });
  expect(a.ok && b.ok && c.ok, 'fixtures size');
  if (!a.ok || !b.ok || !c.ok) return;
  expect(a.sharesRaw === 10 && a.shares === 10 && a.cost === 250 && a.lossIfStopped === 10, `fixture A ${JSON.stringify(a)}`);
  expect(b.sharesRaw === 33 && b.shares === 31 && b.cost === 1240 && b.lossIfStopped === 46.5, `fixture B ${JSON.stringify(b)}`);
  expect(c.sharesRaw === 50 && c.shares === 46 && c.cost === 368 && c.lossIfStopped === 13.8, `fixture C ${JSON.stringify(c)}`);
  expect(b.capped === true && a.capped === false, 'cap applies only when cost would exceed 25%');
  const skip = sizePosition({ account: 1000, entry: 10, stop: 10 });
  expect(skip.ok === false, 'flat stop is a skip');
}

function testModuleShape() {
  expect(jewbotModule.id === 'street-trader', 'module id');
  expect(jewbotModule.capabilities.includes('local-only'), 'local-only capability');
  expect(!jewbotModule.capabilities.includes('stub'), 'stub capability is gone');
  const names = (jewbotModule.tools || []).map((tool) => tool.name);
  expect(names.join() === 'street_ask,street_outline,street_journal_prompt', `tools ${names.join()}`);
  expect(typeof modules.streetTrader.streetAsk === 'function', 'barrel exports streetAsk');
  expect(modules.streetTrader.jewbotModule.id === 'street-trader', 'barrel exports the module');
  expect(isLiveOrderRequest('Place my order for 10 shares') === true, 'order phrase is refused');
  expect(isLiveOrderRequest('Where does a stop go on a chart?') === false, 'a teaching question is not an order');
}

function testSourcesStayLocal() {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'street-trader');
  const banned = ['openai.com', 'anthropic.com', 'api.x.ai', 'grok.com', 'alpaca', 'polygon.io', 'brokerage sdk'];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8').toLowerCase();
    for (const needle of banned) expect(!text.includes(needle), `${file} contains ${needle}`);
  }
  const localSrc = fs.readFileSync(path.join(dir, 'local.ts'), 'utf8');
  expect(localSrc.includes('assertLocalSpendOnly'), 'street ask path calls assertLocalSpendOnly');
  expect(localSrc.includes('chatOnce'), 'street ask uses ollama chatOnce');
  expect(!fs.readFileSync(path.join(dir, 'index.ts'), 'utf8').includes('migrationStub'), 'index is not the stub');
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
      await expectThrow(() => streetHealth({ host, model: 'x' }), /Paid\/cloud|Refusing/i, `health ${host}`);
      await expectThrow(
        () => streetAsk('How does the 1% rule work?', { host, model: 'x', allowPaidApis: true }),
        /Paid\/cloud|Refusing/i,
        `ask ${host}`,
      );
      await expectThrow(
        () => assertStreetLocal({ host, model: 'x', allowPaidApis: true }),
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

async function testAskReturnsDisclaimer() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(url === `${STREET_DEFAULT_HOST}/api/chat`, `chat url ${url}`);
    const body = String(init?.body ?? '');
    expect(body.includes('Not financial advice') || body.includes('not a financial adviser'), 'system prompt has the disclaimer');
    expect(body.includes('local Ollama'), 'system prompt is local-only');
    expect(body.includes('1%'), 'sizing question pulls the cached rule');
    return new Response(ndjson('Risk 1% and round down. Not a pick.'), { status: 200 });
  };
  try {
    const reply = await streetAsk('How many shares does the 1% rule allow?', local);
    expect(reply.refusedOrder === false, 'teaching question is not an order refusal');
    expect(reply.disclaimer === STREET_DISCLAIMER, 'disclaimer field');
    expect(reply.text.startsWith(STREET_DISCLAIMER), 'disclaimer leads the text');
    expect(/not financial advice/i.test(reply.text), 'text includes not financial advice');
    expect(reply.answer.includes('round down'), `answer ${reply.answer}`);
    expect(reply.spend === 'local-only', 'spend label');
    expect(calls.length === 1, `chat calls ${calls.join(',')}`);
  } finally {
    globalThis.fetch = original;
  }
}

async function testOrderNeverFetches() {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error('fetch should not run');
  };
  try {
    const reply = await streetAsk('Submit my order at market for me', local);
    expect(reply.refusedOrder === true, 'order is refused');
    expect(/does not place trades/i.test(reply.text), 'refusal says no trades');
    expect(/not financial advice/i.test(reply.text), 'refusal still has the disclaimer');
    expect(fetches === 0, `order fetched ${fetches}`);
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
    process.env.OLLAMA_HOST = STREET_DEFAULT_HOST;
    process.env.JEWBOT_MODEL = 'test-model';
    process.env.JEWBOT_ALLOW_PAID = '1';
    globalThis.fetch = async (input: RequestInfo | URL) => {
      calls += 1;
      expect(String(input) === `${STREET_DEFAULT_HOST}/api/tags`, `tags url ${String(input)}`);
      return new Response(JSON.stringify({ models: [{ name: 'test-model' }] }), { status: 200 });
    };
    const health = await jewbotModule.health();
    expect(health.ok === true, health.detail || 'health failed');
    expect((health.detail || '').includes('test-model'), `detail ${health.detail}`);
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
  testOutlineCoversFive();
  testJournal();
  testSizingFixtures();
  testModuleShape();
  testSourcesStayLocal();
  await testRefusesPaidHosts();
  await testAskReturnsDisclaimer();
  await testOrderNeverFetches();
  await testHealthPing();
  console.log('smoke-street-trader: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
