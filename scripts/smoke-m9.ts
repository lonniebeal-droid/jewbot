/**
 * M9 editor smoke. Temp project. No network. No Monaco binary required.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileWorkspace } from '../src/modules/files';
import {
  bindMonaco,
  EditorSession,
  jewbotModule,
  MONACO_CONTAINER_ID,
  MONACO_EDITOR_OPTIONS,
  tabLabel,
} from '../src/modules/editor';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m9-'));
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello\n');
  return root;
}

function testTabsAndDirty() {
  const session = new EditorSession();
  const tab = session.open('note.txt', 'hello\n');
  expect(tab.dirty === false, 'fresh tab is clean');
  expect(tabLabel(tab) === 'note.txt', 'clean label has no marker');
  session.editHuman('note.txt', 'hello world\n');
  expect(tab.dirty === true && tab.origin === 'human', 'typing marks dirty');
  expect(tabLabel(tab) === 'note.txt •', 'dirty marker');
  session.open('note.txt', 'ignored');
  expect(session.tabs.length === 1, 'open is idempotent');
  session.open('other.ts', 'export {}\n');
  expect(session.active === 'other.ts', 'new tab is active');
  session.close('other.ts');
  expect(session.active === 'note.txt', 'close focuses a remaining tab');
}

async function testHumanSaveWrites() {
  const root = tempRoot();
  const files = new FileWorkspace(root);
  const session = new EditorSession();
  session.open('note.txt', 'hello\n');
  session.editHuman('note.txt', 'saved by hand\n');
  const outcome = await session.save('note.txt', files);
  expect(outcome.kind === 'saved', `human save kind ${outcome.kind}`);
  expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8') === 'saved by hand\n', 'disk matches the buffer');
  expect(session.tabs[0].dirty === false, 'saved tab is clean');
}

async function testAgentSaveReviews() {
  const root = tempRoot();
  const files = new FileWorkspace(root);
  const session = new EditorSession();
  session.open('note.txt', 'hello\n');
  session.proposeAgent('note.txt', 'from the agent\n');
  const outcome = await session.save('note.txt', files);
  expect(outcome.kind === 'review', `agent save kind ${outcome.kind}`);
  expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8') === 'hello\n', 'agent save does not write');
  await session.acceptAgent('note.txt', files);
  expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8') === 'from the agent\n', 'accept writes');
  expect(session.tabs[0].origin === 'human' && session.tabs[0].dirty === false, 'accepted tab is clean');
}

function testMonacoBinding() {
  const changes: string[] = [];
  let value = '';
  let silentSets = 0;
  const listeners: Array<() => void> = [];
  const fake = {
    getValue: () => value,
    setValue(next: string) {
      value = next;
      silentSets += 1;
      for (const listener of listeners) listener();
    },
    onDidChangeModelContent(cb: () => void) {
      listeners.push(cb);
      return { dispose() {} };
    },
    dispose() {},
  };
  const binding = bindMonaco(fake, 'hello\n', (text) => changes.push(text));
  expect(value === 'hello\n', 'initial value pushed');
  expect(changes.length === 0, 'setValue is not a human edit');
  value = 'typed\n';
  for (const listener of listeners) listener();
  expect(changes.join() === 'typed\n', 'keystrokes notify');
  const before = silentSets;
  binding.push('typed\n');
  expect(silentSets === before, 'push skips an identical value');
  binding.push('agent\n');
  expect(changes.length === 1, 'programmatic push is silent');
  expect(MONACO_CONTAINER_ID === 'monacoEditor', 'container id');
  expect(MONACO_EDITOR_OPTIONS.theme === 'vs-dark', 'dark monaco theme');
  expect(jewbotModule.id === 'editor', 'module id');
  expect(!jewbotModule.capabilities.includes('stub'), 'not a stub');
}

async function main() {
  testTabsAndDirty();
  await testHumanSaveWrites();
  await testAgentSaveReviews();
  testMonacoBinding();
  console.log('smoke-m9: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
