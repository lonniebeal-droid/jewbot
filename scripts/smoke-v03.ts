/**
 * v0.3 window wiring. Checks the build copies Monaco and the renderer hooks exist.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function testSources() {
  const editor = read('src/renderer/editor.js');
  const chat = read('src/renderer/renderer.js');
  const composer = read('src/renderer/composer.js');
  const git = read('src/renderer/git.js');
  expect(editor.includes("key.toLowerCase() === 'k'"), 'Ctrl/Cmd+K is bound');
  expect(editor.includes('editorInline'), 'inline edit calls the bridge');
  expect(chat.includes('expandMentions'), 'chat expands mentions before send');
  expect(composer.includes('Accept hunk') && composer.includes('Reject hunk'), 'composer hunk buttons');
  expect(git.includes('gitConfirm') && git.includes("guarded('push'"), 'git push uses the confirm path');
  expect(!git.includes('git push origin') && git.includes('Nothing here pushes on its own'), 'sidebar does not auto-push');
}

function testMonacoCopy() {
  execFileSync(process.execPath, [path.join(__dirname, 'copy-static.js')], { stdio: 'inherit' });
  const loader = path.join(__dirname, '..', 'dist', 'renderer', 'vs', 'loader.js');
  const main = path.join(__dirname, '..', 'dist', 'renderer', 'vs', 'editor', 'editor.main.js');
  expect(fs.existsSync(loader), 'build copied Monaco loader');
  expect(fs.existsSync(main), 'build copied Monaco editor.main');
}

function main() {
  testSources();
  testMonacoCopy();
  console.log('smoke-v03: PASS');
}

main();
