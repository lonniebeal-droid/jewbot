/**
 * Headless Ollama check for CI. Requires a local server and two pulled models:
 * qwen2.5-coder:3b for the agent and fill-in-the-middle, nomic-embed-text for embeddings.
 * Not part of `npm test`.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { generateFim } from '../src/modules/llm/fim';
import { embedTexts } from '../src/modules/semantic/embed';
import { defaultSshManager } from '../src/modules/ssh';
import { defaultTerminal } from '../src/modules/terminal';

const HOST = 'http://127.0.0.1:11434';
const CHAT_MODEL = process.env.JEWBOT_MODEL || 'qwen2.5-coder:3b';
const FIM_MODEL = process.env.JEWBOT_FIM_MODEL || 'qwen2.5-coder:0.5b';
const EMBED_MODEL = process.env.JEWBOT_EMBED_MODEL || 'nomic-embed-text';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function warm(model: string): Promise<void> {
  const res = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'Say hi', stream: false }),
  });
  if (!res.ok) throw new Error(`Warm ${model} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const tags = await fetch(`${HOST}/api/tags`);
  expect(tags.ok, 'Ollama /api/tags is not reachable');

  await warm(CHAT_MODEL);
  await warm(FIM_MODEL);
  const middle = await generateFim({
    host: HOST,
    model: FIM_MODEL,
    prompt: 'function add(a, b) {\n  return ',
    suffix: ';\n}\n',
  });
  expect(middle.trim().length > 0, 'FIM returned an empty completion');

  const [vector] = await embedTexts({ host: HOST, input: ['local jewbot docs'], model: EMBED_MODEL });
  expect(Array.isArray(vector) && vector.length > 8, 'embed call did not return a vector');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-e2e-'));
  await fs.writeFile(
    path.join(root, 'check.js'),
    "const fs=require('fs');const t=fs.readFileSync('hello.txt','utf8');if(t!=='hello jewbot\\n')process.exit(1);console.log('e2e-ok');\n",
  );
  const files = new FileWorkspace(root);
  const context = new ContextIndexer(root);
  const goal = [
    'You must execute all three tools. Never reply FINAL before the terminal tool returns e2e-ok.',
    'Your first response must be only this JSON tool call:',
    '{"tool":"read_file","args":{"path":"hello.txt"}}',
    'After its observation, your second response must be only this JSON tool call:',
    '{"tool":"write_file","args":{"path":"hello.txt","content":"hello jewbot\\n"}}',
    'Accept the proposed edit when the confirmation callback is offered.',
    'After the edit observation, your third response must be only this JSON tool call:',
    '{"tool":"run_terminal","args":{"command":"node check.js"}}',
    'After observing e2e-ok, reply FINAL: done. If any tool is unavailable, reply BLOCKED and do not claim success.',
  ].join('\n');

  let passed = false;
  let last = '';
  try {
    for (let attempt = 1; attempt <= 3 && !passed; attempt += 1) {
      await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n');
      let acceptedThisRun = false;
      const agent = new AgentLoop({
        files,
        terminal: defaultTerminal,
        ssh: defaultSshManager,
        context,
        llm: { host: HOST, model: CHAT_MODEL, allowPaidApis: false },
        maxSteps: 12,
        toolRetries: 3,
        confirmEdit: async (req) => {
          const ok = req.unifiedDiff.includes('hello jewbot');
          if (ok) acceptedThisRun = true;
          return ok;
        },
      });
      const result = await agent.run(goal);
      const sawRead = result.steps.some((step) => step.tool?.name === 'read_file');
      const sawTest = result.steps.some(
        (step) => step.tool?.name === 'run_terminal' && (step.observation || '').includes('e2e-ok'),
      );
      const body = await fs.readFile(path.join(root, 'hello.txt'), 'utf8');
      passed = result.status === 'done' && sawRead && acceptedThisRun && sawTest && body === 'hello jewbot\n';
      last = `attempt ${attempt}: status=${result.status} read=${sawRead} accepted=${acceptedThisRun} test=${sawTest} bodyOk=${body === 'hello jewbot\n'} reason=${result.blockReason ?? ''}`;
    }
    expect(passed, `AgentLoop acceptance did not complete the full read -> accepted edit -> terminal test sequence (${last})`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('e2e-ollama: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
