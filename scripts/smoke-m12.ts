/**
 * M12 composer smoke. Temp files. No network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileWorkspace } from '../src/modules/files';
import { ComposerBatch, jewbotModule } from '../src/modules/composer';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function project(): { root: string; files: FileWorkspace } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m12-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha\nbeta\ngamma\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'one\n');
  return { root, files: new FileWorkspace(root) };
}

async function testHunkAndFile() {
  const { root, files } = project();
  const batch = new ComposerBatch();
  const file = batch.addFile('a.txt', 'alpha\nbeta\ngamma\n', 'ALPHA\nbeta\nGAMMA\n');
  expect(file.hunks.length === 2, `hunks ${file.hunks.length}`);
  batch.acceptHunk(file.hunks[0].id);
  batch.rejectHunk(file.hunks[1].id);
  expect(batch.composed('a.txt') === 'ALPHA\nbeta\ngamma\n', batch.composed('a.txt'));
  batch.addFile('b.txt', 'one\n', 'two\n');
  batch.acceptFile('b.txt');
  const applied = await batch.apply(files);
  expect(applied.written.join() === 'a.txt,b.txt', applied.written.join());
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'ALPHA\nbeta\ngamma\n', 'partial file write');
  expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8') === 'two\n', 'whole file accept');
  const undone = await batch.undo(files);
  expect(undone.restored.length === 2, 'one undo covers the batch');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'alpha\nbeta\ngamma\n', 'a restored');
  expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8') === 'one\n', 'b restored');
  batch.rejectFile('a.txt');
  expect(batch.composed('a.txt') === 'alpha\nbeta\ngamma\n', 'reject file keeps the original');
  expect(jewbotModule.id === 'composer', 'module id');
}

async function main() {
  await testHunkAndFile();
  console.log('smoke-m12: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
