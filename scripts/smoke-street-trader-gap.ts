/**
 * GAP-JB-06 acceptance. Exactly three curriculum fixtures, plus one check
 * that an offline local Ollama does not call a paid provider.
 * No brokerage, no live model, no Drive credentials.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as modules from '../src/modules';
import { appendDriveLog, exportDriveLog, MASTER3_CONTINUATION_DOC_ID } from '../src/modules/street-trader';
import { teachFromCurriculum } from '../src/modules/street-trader/curriculum';
import { STREET_DEFAULT_HOST, streetAsk } from '../src/modules/street-trader/local';
import { STREET_DISCLAIMER, STREET_SYSTEM_PROMPT } from '../src/modules/street-trader/prompts';

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

const FIXTURES = [
  {
    question: 'How does position sizing use the 1% rule to decide how many shares to buy?',
    heading: 'MODULE 1 — POSITION SIZING (HOW MUCH TO BUY)',
  },
  {
    question: 'When do I walk away for the day, and what does a 2:1 reward-to-risk mean?',
    heading: 'MODULE 2 — RISK MANAGEMENT (STAYING IN THE GAME)',
  },
  {
    question: 'A signal group promised guaranteed returns. What are the red flags and where do I report it?',
    heading: 'MODULE 4 — SPOTTING SCAMS AND PUMP-AND-DUMPS',
  },
] as const;

function noFinancialGuarantee(text: string): boolean {
  const opening = text.split('Source file:')[0] || '';
  const closing = text.split('\n').slice(-2).join('\n');
  const frame = `${opening}\n${closing}`;
  if (/you should buy|i recommend (buying|a stock|this ticker)|place an order|brokerage connection is open/i.test(text)) {
    return false;
  }
  if (/guaranteed (profit|returns|income)|you will make money/i.test(frame)) return false;
  return /not financial advice/i.test(frame) && /does not connect to a brokerage/i.test(frame) && /not an order/i.test(closing);
}

async function testThreeFixtures() {
  expect(FIXTURES.length === 3, 'exactly three acceptance fixtures');
  const log = path.join(os.tmpdir(), `street-trader-gap-${process.pid}.jsonl`);
  if (fs.existsSync(log)) fs.unlinkSync(log);
  const saved = process.env.JEWBOT_STREET_DRIVE_LOG;
  process.env.JEWBOT_STREET_DRIVE_LOG = log;
  try {
    expect(modules.street_trader.jewbotModule.id === 'street-trader', 'alias keeps the registry id');
    expect(modules.streetTrader.jewbotModule === modules.street_trader.jewbotModule, 'alias is the same module');
    expect(STREET_SYSTEM_PROMPT.includes('not a financial adviser'), 'system prompt stays education-only');
    const tools = modules.streetTrader.jewbotModule.tools || [];
    expect(tools.length === 4, 'ask, outline, journal, drive_log');
    for (const tool of tools) {
      expect(!!tool.inputSchema && tool.inputSchema.type === 'object', `${tool.name} JSON schema`);
    }
    for (const fixture of FIXTURES) {
      const taught = await teachFromCurriculum(fixture.question, { embed: null });
      expect(taught.mode === 'keyword', `${fixture.heading} used the keyword fallback`);
      expect(taught.heading === fixture.heading, `cited ${taught.heading}, expected ${fixture.heading}`);
      expect(taught.text.includes(`Cited section: ${fixture.heading}`), 'section is cited in the reply');
      expect(taught.disclaimer === STREET_DISCLAIMER, 'disclaimer constant');
      expect(noFinancialGuarantee(taught.text), `fixture leaked advice: ${fixture.heading}`);
      const receipt = appendDriveLog({ task: fixture.question, kind: 'RECEIPT', section: taught.heading }, log);
      expect(receipt.spend === '$0', 'receipt spend');
      expect(receipt.exported === false, 'receipt is not exported');
      expect(receipt.line.includes('$0'), 'receipt line ends at $0');
      expect(receipt.line.includes(fixture.heading), 'receipt names the section');
    }
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    expect(lines.length === 3, `jsonl lines ${lines.length}`);
    const first = fs.readFileSync(log, 'utf8');
    appendDriveLog({ task: 'second session', kind: 'STATUS' }, log);
    const after = fs.readFileSync(log, 'utf8');
    expect(after.startsWith(first), 'drive log is append-only');
    const exported = exportDriveLog();
    expect(exported.exported === false, 'exporter stays off');
    expect(exported.targetDocId === MASTER3_CONTINUATION_DOC_ID, 'exporter names the continuation doc');
    expect(!/api[_-]?key|secret|credential/i.test(JSON.stringify(exported)), 'exporter result has no credentials');
  } finally {
    if (saved === undefined) delete process.env.JEWBOT_STREET_DRIVE_LOG;
    else process.env.JEWBOT_STREET_DRIVE_LOG = saved;
    fs.rmSync(log, { force: true });
  }
}

async function testOfflineDoesNotCallCloud() {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const log = path.join(os.tmpdir(), `street-trader-offline-${process.pid}.jsonl`);
  const saved = process.env.JEWBOT_STREET_DRIVE_LOG;
  const savedPaid = process.env.JEWBOT_ALLOW_PAID;
  process.env.JEWBOT_STREET_DRIVE_LOG = log;
  process.env.JEWBOT_ALLOW_PAID = '1';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    throw new Error(`connect ECONNREFUSED ${url}`);
  };
  try {
    await expectThrow(
      () => streetAsk('How does the 1% rule work?', { host: 'https://api.openai.com/v1', model: 'gpt-4o', allowPaidApis: true }),
      /Paid\/cloud|Refusing/i,
      'paid host is refused before offline',
    );
    expect(urls.length === 0, `paid host fetched ${urls.join(',')}`);
    await expectThrow(
      () => streetAsk('How does the 1% rule work?', { host: STREET_DEFAULT_HOST, model: 'qwen2.5-coder:7b' }),
      /^local model offline$/,
      'offline local model',
    );
    expect(urls.length > 0, 'local offline tried Ollama');
    expect(urls.every((url) => url.startsWith(STREET_DEFAULT_HOST)), `non-local fetch ${urls.join(',')}`);
    const paid = /openai|anthropic|googleapis|api\.x\.ai|grok\.com|generativelanguage/i;
    expect(!urls.some((url) => paid.test(url)), 'no paid provider was called');
    const logged = fs.readFileSync(log, 'utf8');
    expect(logged.includes('BLOCKER') && logged.includes('local model offline') && logged.includes('$0'), 'blocker receipt');
    const stub = exportDriveLog();
    expect(stub.exported === false && urls.every((url) => url.startsWith(STREET_DEFAULT_HOST)), 'stub exporter did not fetch');
  } finally {
    globalThis.fetch = original;
    if (saved === undefined) delete process.env.JEWBOT_STREET_DRIVE_LOG;
    else process.env.JEWBOT_STREET_DRIVE_LOG = saved;
    if (savedPaid === undefined) delete process.env.JEWBOT_ALLOW_PAID;
    else process.env.JEWBOT_ALLOW_PAID = savedPaid;
    fs.rmSync(log, { force: true });
  }
}

async function main() {
  await testThreeFixtures();
  await testOfflineDoesNotCallCloud();
  console.log('smoke-street-trader-gap: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
