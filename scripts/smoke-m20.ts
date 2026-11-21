/**
 * M20 background agents. LAN SSH, local Ollama, reviewable diff, no auto-apply.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acceptBackgroundTask,
  assertBackgroundHost,
  enqueueBackgroundTask,
  remoteChatCommand,
  runBackgroundTask,
} from '../src/modules/background';
import { FileWorkspace } from '../src/modules/files';
import { checkShellCommand } from '../src/modules/safety';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assertBackgroundHost('192.168.1.20');
  assertBackgroundHost('pi');
  let refused = false;
  try {
    assertBackgroundHost('8.8.8.8');
  } catch (err) {
    refused = /not local or LAN/.test(err instanceof Error ? err.message : '');
  }
  expect(refused, 'a public address is refused');
  let paid = false;
  try {
    assertBackgroundHost('api.openai.com');
  } catch (err) {
    paid = /Paid host/.test(err instanceof Error ? err.message : '');
  }
  expect(paid, 'a paid host is refused');

  const command = remoteChatCommand('tinyllama', 'please rm -rf /tmp/nope');
  expect(command.includes('http://127.0.0.1:11434/api/chat'), command);
  expect(!command.includes('rm -rf'), 'the goal is not a shell command');
  const decision = checkShellCommand(command);
  expect(decision.ok === true, decision.ok ? 'ok' : decision.reason);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m20-'));
  const files = new FileWorkspace(root);
  const calls: string[] = [];
  try {
    const queued = enqueueBackgroundTask({ name: 'pi', host: '192.168.1.20' }, 'tinyllama', 'add a note');
    expect(queued.status === 'queued', queued.status);
    const review = await runBackgroundTask(queued, { name: 'pi', host: '192.168.1.20' }, {
      async exec(host, cmd) {
        calls.push(`${host} ${cmd}`);
        return {
          stdout: JSON.stringify({ message: { content: '{"files":[{"path":"note.txt","content":"hello from pi\\n"}]}' } }),
          stderr: '',
          exitCode: 0,
        };
      },
    });
    expect(review.status === 'review' && (review.diff || '').includes('hello from pi'), review.error || review.diff || '');
    expect(!(await fs.readdir(root)).includes('note.txt'), 'run does not write');
    let held = false;
    try {
      await acceptBackgroundTask(review, files, false);
    } catch (err) {
      held = /confirmation/.test(err instanceof Error ? err.message : '');
    }
    expect(held, 'accept waits for confirmation');
    await acceptBackgroundTask(review, files, true);
    expect(await fs.readFile(path.join(root, 'note.txt'), 'utf8') === 'hello from pi\n', 'accept writes the review');
    expect(calls.length === 1 && calls[0].startsWith('pi '), 'one SSH exec');

    const renderer = await fs.readFile(path.join(process.cwd(), 'src/renderer/renderer.js'), 'utf8');
    expect(renderer.includes('backgroundAccept') && renderer.includes('window.confirm'), 'the window asks before apply');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('smoke-m20: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
