/**
 * M18 rules. Local files only. The toggle is a boolean in the settings file.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import type { OllamaConfig } from '../src/modules/llm';
import { loadRules, setRulesEnabled, systemWithRules } from '../src/modules/rules';
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m18-'));
  const settings = path.join(root, 'settings.json');
  process.env.JEWBOT_SETTINGS_FILE = settings;
  await fs.mkdir(path.join(root, '.jewbot'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'panel'), { recursive: true });
  await fs.writeFile(path.join(root, '.jewbot', 'rules.md'), 'Prefer small local models.\n');
  await fs.writeFile(path.join(root, 'src', 'rules.md'), 'Keep the panel local.\n');
  await fs.writeFile(path.join(root, 'src', 'panel', 'rules.md'), 'Name the button Rules.\n');
  await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n');
  await fs.writeFile(path.join(os.tmpdir(), 'jewbot-m18-outside.md'), 'nope\n');
  await fs.mkdir(path.join(root, 'src', 'linked'), { recursive: true });
  try {
    await fs.symlink(path.join(os.tmpdir(), 'jewbot-m18-outside.md'), path.join(root, 'src', 'linked', 'rules.md'));
  } catch {
    // a platform without symlinks still has the in-project files
  }

  const original = globalThis.fetch;
  try {
    const loaded = loadRules(root, 'src/panel');
    expect(loaded.includes('Prefer small local models'), 'root rules load');
    expect(loaded.includes('Keep the panel local'), 'parent folder rules load');
    expect(loaded.includes('Name the button Rules'), 'folder rules load');
    expect(!loadRules(root, 'src/linked').includes('nope'), 'a symlink is not followed');
    expect(systemWithRules('BASE', root, 'src/panel').startsWith('BASE\n\nProject rules:'), 'rules append to the prompt');

    await fs.writeFile(settings, JSON.stringify({ models: { chat: 'tiny' }, rules: true }));
    setRulesEnabled(false, settings);
    const saved = JSON.parse(await fs.readFile(settings, 'utf8')) as { models?: { chat?: string }; rules?: boolean };
    expect(saved.rules === false && saved.models?.chat === 'tiny', 'the toggle keeps other settings');
    expect(loadRules(root, 'src/panel') === '', 'rules stay out of the prompt when the toggle is off');

    setRulesEnabled(true, settings);
    expect(loadRules(root).includes('Prefer small local models'), `rules did not turn back on: ${JSON.stringify(loadRules(root))}`);
    let system = '';
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ role: string; content: string }> };
      system = body.messages?.find((message) => message.role === 'system')?.content || '';
      return new Response(ndjson('FINAL: rules seen'), { status: 200 });
    };
    const agent = new AgentLoop({
      files: new FileWorkspace(root),
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context: new ContextIndexer(root),
      llm: localCfg,
      maxSteps: 2,
    });
    const result = await agent.run('look at the rules');
    expect(result.status === 'done', result.blockReason ?? '');
    expect(system.includes('Prefer small local models') && system.includes('Name the button Rules'), 'the agent prompt includes the project and folder rules');

    const renderer = await fs.readFile(path.join(process.cwd(), 'src/renderer/renderer.js'), 'utf8');
    expect(renderer.includes('rulesSet') && renderer.includes('rulesEnabled'), 'the window has a rules toggle');
  } finally {
    globalThis.fetch = original;
    delete process.env.JEWBOT_SETTINGS_FILE;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(path.join(os.tmpdir(), 'jewbot-m18-outside.md'), { force: true });
  }
  console.log('smoke-m18: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
