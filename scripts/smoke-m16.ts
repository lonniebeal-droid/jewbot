/**
 * M16 agent loop: step budget, invalid-JSON retry, fix-tests, and stop.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop, parseFixTests, stepBudget, toolReplyKind } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import type { OllamaConfig } from '../src/modules/llm';
import { defaultSshManager } from '../src/modules/ssh';
import { defaultTerminal } from '../src/modules/terminal';

const localCfg: OllamaConfig = {
  host: 'http://127.0.0.1:11434',
  model: 'test-model',
  allowPaidApis: false,
};

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

async function main() {
  expect(stepBudget(undefined) === 12, 'default budget is 12');
  expect(stepBudget(3) === 3, 'explicit budget wins');
  const previous = process.env.JEWBOT_AGENT_MAX_STEPS;
  process.env.JEWBOT_AGENT_MAX_STEPS = '5';
  expect(stepBudget(undefined) === 5, 'env budget');
  if (previous === undefined) delete process.env.JEWBOT_AGENT_MAX_STEPS;
  else process.env.JEWBOT_AGENT_MAX_STEPS = previous;

  expect(toolReplyKind('{"tool":') === 'invalid', 'broken tool json');
  expect(toolReplyKind('{"tool":"list_dir","args":{}}') === 'tool', 'valid tool');
  expect(parseFixTests('fix tests: npm test\nplease')?.command === 'npm test', 'fix tests command');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m16-'));
  await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n');
  const files = new FileWorkspace(root);
  const context = new ContextIndexer(root);
  const original = globalThis.fetch;
  try {
    let calls = 0;
    const script = [
      '{"tool":"read_file","args":{"path":"hello.txt"}',
      '{"tool":"read_file","args":{"path":"hello.txt"}}',
      'FINAL: read hello',
    ];
    globalThis.fetch = async () => {
      const content = script[Math.min(calls, script.length - 1)];
      calls += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const retried = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm: localCfg,
      maxSteps: 2,
      toolRetries: 2,
    });
    const retryResult = await retried.run('read hello.txt');
    expect(retryResult.status === 'done', `retry status ${retryResult.status} ${retryResult.blockReason ?? ''}`);
    expect(calls === 3, `retry calls ${calls}`);
    expect(retryResult.steps.length === 2, `steps stayed inside the budget ${retryResult.steps.length}`);

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(ndjson('{"tool":"list_dir","args":{"path":"."}}'), { status: 200 });
    };
    const capped = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm: localCfg,
      maxSteps: 1,
    });
    const cappedResult = await capped.run('keep listing');
    expect(cappedResult.status === 'blocked' && cappedResult.blockReason === 'max steps reached', cappedResult.blockReason ?? '');
    expect(cappedResult.steps.length === 1, 'budget stops the loop');

    const ctrl = new AbortController();
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      ctrl.abort();
      return new Response(ndjson('{"tool":"list_dir","args":{"path":"."}}'), { status: 200 });
    };
    const stopping = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm: localCfg,
      maxSteps: 4,
    });
    const stopped = await stopping.run('stop me', ctrl.signal);
    expect(stopped.status === 'blocked' && stopped.blockReason === 'Cancelled', stopped.blockReason ?? '');

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(ndjson('FINAL: tests seen'), { status: 200 });
    };
    const fixer = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm: localCfg,
      maxSteps: 2,
    });
    const fixed = await fixer.run('fix tests: node -e "process.stdout.write(\'m16-ok\')"');
    expect(fixed.status === 'done', `fix status ${fixed.status} ${fixed.blockReason ?? ''}`);
    expect(calls === 1, 'the model runs after the terminal');

    const danger = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm: localCfg,
      maxSteps: 2,
    });
    const blocked = await danger.run('fix tests: rm -rf /tmp/jewbot-m16-nope');
    expect(blocked.status === 'blocked' && (blocked.blockReason || '').includes('BLOCKED'), blocked.blockReason ?? '');
    expect(calls === 1, 'a destructive test command does not call the model');

    const renderer = await fs.readFile(path.join(process.cwd(), 'src/renderer/renderer.js'), 'utf8');
    expect(renderer.includes("document.getElementById('stop').onclick") && renderer.includes('cancelStream(activeRequest)'), 'stop button aborts the stream');
    expect(renderer.includes('fix tests: npm test'), 'fix tests mode is in the window');
  } finally {
    globalThis.fetch = original;
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('smoke-m16: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
