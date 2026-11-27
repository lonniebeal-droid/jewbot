/**
 * Persona is opt-in and does not weaken the destructive-command gate.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { personaSuffix } from '../src/modules/persona';
import { defaultSshManager } from '../src/modules/ssh';
import { defaultTerminal } from '../src/modules/terminal';

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-persona-'));
  const settings = path.join(dir, 'settings.json');
  const project = path.join(dir, 'proj');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'hello.txt'), 'hello\n');
  const previous = process.env.JEWBOT_SETTINGS_FILE;
  process.env.JEWBOT_SETTINGS_FILE = settings;
  const original = globalThis.fetch;
  let system = '';
  try {
    expect(personaSuffix(settings) === '', 'missing settings leave the voice off');
    await fs.writeFile(settings, JSON.stringify({ rules: true, persona: 'polite' }));
    expect(personaSuffix(settings) === '', 'only the based value turns the voice on');
    await fs.writeFile(settings, JSON.stringify({ rules: true, persona: 'based' }));
    const voice = personaSuffix(settings);
    expect(voice.includes('profane') && voice.includes('safety gate'), voice);

    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ role: string; content: string }> };
      system = body.messages?.find((message) => message.role === 'system')?.content || '';
      return new Response(
        ndjson('{"tool":"run_terminal","args":{"command":"rm -rf /tmp/jewbot-persona-nope"}}'),
        { status: 200 },
      );
    };
    const agent = new AgentLoop({
      files: new FileWorkspace(project),
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context: new ContextIndexer(project),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 2,
    });
    const result = await agent.run('delete the temp dir');
    expect(system.includes('profane') && system.includes('Do not run a destructive command'), 'the prompt is blunt and still names the gate');
    const observation = result.steps.map((step) => step.observation || '').join('\n');
    expect(observation.includes('BLOCKED'), observation || result.blockReason || '');
    expect((await fs.readFile(path.join(project, 'hello.txt'), 'utf8')) === 'hello\n', 'the file is untouched');
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.JEWBOT_SETTINGS_FILE;
    else process.env.JEWBOT_SETTINGS_FILE = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('smoke-persona: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
