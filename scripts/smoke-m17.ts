/**
 * M17 model manager. Mocked Ollama. Delete needs the confirm grant.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { completionModel } from '../src/modules/llm/fim';
import { deleteLocalModel, featureModel, listLocalModels, pullLocalModel, saveFeatureModels } from '../src/modules/models';
import { issueConfirmation } from '../src/modules/safety';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m17-'));
  const file = path.join(dir, 'settings.json');
  process.env.JEWBOT_SETTINGS_FILE = file;
  const previousComplete = process.env.JEWBOT_COMPLETE_MODEL;
  delete process.env.JEWBOT_COMPLETE_MODEL;
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    saveFeatureModels({ chat: 'tiny', autocomplete: 'qwen-small', embeddings: 'nomic-embed-text', inlineEdit: 'edit-model' }, file);
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { rules?: boolean; models: { chat: string } };
    raw.rules = true;
    await fs.writeFile(file, JSON.stringify(raw));
    saveFeatureModels({ chat: 'tinyllama' }, file);
    const kept = JSON.parse(await fs.readFile(file, 'utf8')) as { rules?: boolean; models: Record<string, string> };
    expect(kept.rules === true, 'other settings keys stay');
    expect(kept.models.chat === 'tinyllama' && kept.models.autocomplete === 'qwen-small', JSON.stringify(kept.models));
    expect(featureModel('chat', file) === 'tinyllama', 'chat model is saved');
    expect(completionModel() === 'qwen-small', `autocomplete uses settings, got ${completionModel()}`);

    globalThis.fetch = async (url, init) => {
      const target = String(url);
      calls.push(`${init?.method || 'GET'} ${target}`);
      if (target.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'tinyllama' }] }), { status: 200 });
      }
      if (target.endsWith('/api/pull')) return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
      if (target.endsWith('/api/delete')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response('no', { status: 404 });
    };

    const listed = await listLocalModels('http://127.0.0.1:11434');
    expect(listed[0] === 'tinyllama', listed.join(','));
    await pullLocalModel('http://192.168.1.20:11434', 'tinyllama');
    expect(calls.some((line) => line.includes('192.168.1.20') && line.includes('/api/pull')), 'pull stays on the LAN host');

    const refused = await deleteLocalModel('http://127.0.0.1:11434', 'tinyllama');
    expect(refused.needsConfirmation === true && refused.ok === false, 'delete waits for the grant');
    expect(!calls.some((line) => line.includes('/api/delete')), 'delete does not fetch early');
    const { executionId } = issueConfirmation(refused.command);
    const removed = await deleteLocalModel('http://127.0.0.1:11434', 'tinyllama', executionId);
    expect(removed.ok === true, 'confirmed delete runs');
    expect(calls.some((line) => line.startsWith('DELETE')), 'delete uses the Ollama API');

    let paid = false;
    try {
      await listLocalModels('https://api.openai.com');
    } catch (err) {
      paid = /Refusing/.test(err instanceof Error ? err.message : '');
    }
    expect(paid, 'a public host is refused');

    const ui = await fs.readFile(path.join(process.cwd(), 'src/renderer/models.js'), 'utf8');
    expect(ui.includes('window.confirm') && ui.includes('modelsDelete'), 'the window asks before delete');
  } finally {
    globalThis.fetch = original;
    delete process.env.JEWBOT_SETTINGS_FILE;
    if (previousComplete === undefined) delete process.env.JEWBOT_COMPLETE_MODEL;
    else process.env.JEWBOT_COMPLETE_MODEL = previousComplete;
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('smoke-m17: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
