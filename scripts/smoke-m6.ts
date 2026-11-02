/**
 * M6 smoke: cascade queue, auto-advance, blocked-then-skip, acceptance, stop.
 * The LLM is a mocked fetch. No paid APIs. Destructive commands are not executed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CascadeRunner, CascadeTask } from '../src/modules/cascade';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { OllamaConfig } from '../src/modules/llm';
import { describeHostKey, SshManager, createScriptedClientFactory } from '../src/modules/ssh';
import { TerminalSession } from '../src/modules/terminal';

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

function sshString(value: string): Buffer {
  const body = Buffer.from(value);
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  expect(pred(), 'timed out waiting for cascade');
}

function runnerFor(root: string, ssh: SshManager, extra: { maxSteps?: number; maxWallMs?: number; llm?: OllamaConfig } = {}) {
  return new CascadeRunner({
    projectRoot: root,
    files: new FileWorkspace(root),
    terminal: new TerminalSession(),
    ssh,
    context: new ContextIndexer(root),
    llm: extra.llm ?? localCfg,
    maxSteps: extra.maxSteps ?? 4,
    maxWallMs: extra.maxWallMs ?? 15_000,
  });
}

function freshSsh(root: string): SshManager {
  return new SshManager({
    autoload: false,
    hostsPath: path.join(root, 'hosts.json'),
    knownHostsPath: path.join(root, 'known_hosts.json'),
  });
}

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jewbot-m6-'));
  try {
    await fs.promises.writeFile(path.join(root, 'README.md'), '# demo\n');
    await fn(root);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

function statuses(tasks: CascadeTask[]): string {
  return tasks.map((task) => `${task.title}:${task.status}`).join(' ');
}

async function testAutoAdvance() {
  await withRoot(async (root) => {
    const original = globalThis.fetch;
    const goals: string[] = [];
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
      const blob = JSON.stringify(body.messages ?? []);
      const goal = blob.includes('TASK_ECHO') ? 'echo' : blob.includes('TASK_B') ? 'b' : blob.includes('TASK_C') ? 'c' : 'other';
      if (!blob.includes('OBSERVE:')) goals.push(goal);
      if (goal === 'echo' && !blob.includes('OBSERVE:')) {
        return new Response(ndjson(JSON.stringify({ tool: 'run_terminal', args: { command: 'echo jewbot-m6' } })), { status: 200 });
      }
      return new Response(ndjson(`FINAL: done ${goal}`), { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root));
      const order: string[] = [];
      runner.on('finish', (task: CascadeTask) => order.push(`${task.title}:${task.status}`));
      runner.enqueue({ title: 'Echo', prompt: 'TASK_ECHO say hello' });
      runner.enqueue({ title: 'Bee', prompt: 'TASK_B wrap up' });
      runner.enqueue({ title: 'Cee', prompt: 'TASK_C wrap up' });
      await runner.start();
      const tasks = runner.list();
      expect(tasks.every((task) => task.status === 'done'), `auto-advance statuses ${statuses(tasks)}`);
      expect(order.join(',') === 'Echo:done,Bee:done,Cee:done', `order ${order.join(',')}`);
      expect(goals.join(',') === 'echo,b,c', `goals ${goals.join(',')}`);
      const echoReceipt = fs.readFileSync(path.join(root, tasks[0].receipt || ''), 'utf8');
      expect(echoReceipt.includes('run_terminal'), 'receipt names the tool');
      expect(echoReceipt.includes('jewbot-m6'), 'receipt includes command output');
      expect(echoReceipt.includes('Done.'), 'receipt records done');
      expect(fs.existsSync(path.join(root, '.jewbot', 'cascade.json')), 'queue file persisted');
      const reloaded = runnerFor(root, freshSsh(root));
      expect(reloaded.list().map((task) => task.id).join() === tasks.map((task) => task.id).join(), 'reloaded ids');
      expect(reloaded.list().every((task) => task.status === 'done'), 'reloaded statuses');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testBlockedThenSkip() {
  await withRoot(async (root) => {
    const canary = path.join(root, 'canary-dir');
    await fs.promises.mkdir(canary);
    const keyPath = path.join(root, 'id_ed25519');
    await fs.promises.writeFile(keyPath, '-----BEGIN OPENSSH PRIVATE KEY-----\nsmoke\n-----END OPENSSH PRIVATE KEY-----\n', {
      mode: 0o600,
    });
    const hostKey = Buffer.concat([sshString('ssh-ed25519'), Buffer.from('jewbot-m6-host-key')]);
    const fingerprint = describeHostKey(hostKey).fingerprint;
    const knownPath = path.join(root, 'known_hosts.json');
    const ssh = freshSsh(root);
    ssh.configure({
      hostsPath: path.join(root, 'hosts.json'),
      knownHostsPath: knownPath,
      clientFactory: createScriptedClientFactory({ hostKey, onExec: () => ({ stdout: 'should-not-run\n' }) }),
    });
    ssh.registerHost({
      name: 'pi',
      host: '127.0.0.1',
      port: 22,
      username: 'pi',
      privateKeyPath: keyPath,
    });

    const original = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const blob = String(init?.body);
      let content = 'FINAL: no';
      if (blob.includes('TASK_RM')) {
        content = JSON.stringify({
          tool: 'run_terminal',
          args: { command: `rm -rf ${canary}`, approved: true, executionId: 'exec_modelsupplied123' },
        });
      } else if (blob.includes('TASK_EDIT')) {
        content = JSON.stringify({
          tool: 'write_file',
          args: { path: 'README.md', content: 'changed\n', confirmed: true },
        });
      } else if (blob.includes('TASK_SSH')) {
        content = JSON.stringify({ tool: 'ssh_connect', args: { host: 'pi' } });
      } else if (blob.includes('TASK_OK')) {
        content = 'FINAL: skipped the blocked ones';
      }
      return new Response(ndjson(content), { status: 200 });
    };
    try {
      const runner = runnerFor(root, ssh);
      runner.enqueue({ title: 'Rm', prompt: 'TASK_RM delete the canary' });
      runner.enqueue({ title: 'Edit', prompt: 'TASK_EDIT rewrite the readme' });
      runner.enqueue({ title: 'Ssh', prompt: 'TASK_SSH connect to pi' });
      runner.enqueue({ title: 'After', prompt: 'TASK_OK continue' });
      await runner.start();
      const tasks = runner.list();
      expect(tasks[0].status === 'blocked', `rm status ${tasks[0].status} ${tasks[0].reason}`);
      expect((tasks[0].reason || '').includes('confirmation') || (tasks[0].reason || '').includes('Destructive'), tasks[0].reason || 'rm reason');
      expect(tasks[1].status === 'blocked', `edit status ${tasks[1].status} ${tasks[1].reason}`);
      expect((tasks[1].reason || '').includes('Accept'), tasks[1].reason || 'edit reason');
      expect(tasks[2].status === 'blocked', `ssh status ${tasks[2].status} ${tasks[2].reason}`);
      expect((tasks[2].reason || '').includes('host key') || (tasks[2].reason || '').includes('fingerprint'), tasks[2].reason || 'ssh reason');
      expect(tasks[3].status === 'done', `after status ${tasks[3].status} ${tasks[3].reason}`);
      expect(fs.existsSync(canary), 'destructive command ran');
      expect((await fs.promises.readFile(path.join(root, 'README.md'), 'utf8')) === '# demo\n', 'edit was applied');
      const known = fs.existsSync(knownPath) ? await fs.promises.readFile(knownPath, 'utf8') : '';
      expect(!known.includes(fingerprint), 'host key was stored without confirmation');
      const receipt = await fs.promises.readFile(path.join(root, tasks[0].receipt || ''), 'utf8');
      expect(receipt.includes('Blocked.'), 'blocked receipt');
      expect(receipt.includes('did not approve'), 'receipt says it was not approved');
      expect(!receipt.includes('exec_modelsupplied123') || receipt.includes('rm -rf'), 'receipt still describes the command');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testAcceptance() {
  await withRoot(async (root) => {
    const canary = path.join(root, 'keep-me');
    await fs.promises.mkdir(canary);
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(ndjson('FINAL: ready for the check'), { status: 200 });
    try {
      const runner = runnerFor(root, freshSsh(root));
      runner.enqueue({ title: 'Pass', prompt: 'TASK_PASS', acceptance: 'node -e "process.exit(0)"' });
      runner.enqueue({ title: 'Fail', prompt: 'TASK_FAIL', acceptance: 'node -e "process.exit(3)"' });
      runner.enqueue({ title: 'Next', prompt: 'TASK_NEXT' });
      runner.enqueue({ title: 'Dangerous check', prompt: 'TASK_DANGER', acceptance: `rm -rf ${canary}` });
      runner.enqueue({ title: 'After danger', prompt: 'TASK_AFTER' });
      await runner.start();
      const tasks = runner.list();
      expect(tasks[0].status === 'done', `pass ${tasks[0].status} ${tasks[0].reason}`);
      expect(tasks[1].status === 'failed', `fail ${tasks[1].status} ${tasks[1].reason}`);
      expect((tasks[1].reason || '').includes('exit 3'), tasks[1].reason || 'fail reason');
      expect(tasks[2].status === 'done', `next ${tasks[2].status} ${tasks[2].reason}`);
      expect(tasks[3].status === 'blocked', `danger ${tasks[3].status} ${tasks[3].reason}`);
      expect((tasks[3].reason || '').toLowerCase().includes('confirmation'), tasks[3].reason || 'danger reason');
      expect(tasks[4].status === 'done', `after danger ${tasks[4].status}`);
      expect(fs.existsSync(canary), 'acceptance rm ran');
      const failReceipt = await fs.promises.readFile(path.join(root, tasks[1].receipt || ''), 'utf8');
      expect(failReceipt.includes('exit: 3') || failReceipt.includes('exit 3'), 'fail receipt has the exit code');
      const passReceipt = await fs.promises.readFile(path.join(root, tasks[0].receipt || ''), 'utf8');
      expect(passReceipt.includes('exit: 0'), 'pass receipt');
      const requeued = runner.requeue(tasks[1].id);
      expect(requeued?.status === 'pending', 'requeue failed task');
      expect(runner.list()[1].status === 'pending', 'failed task is pending again');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testStop() {
  await withRoot(async (root) => {
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetches += 1;
      await new Promise<void>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
      });
      return new Response(ndjson('FINAL: too late'), { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root), { maxWallMs: 20_000 });
      runner.enqueue({ title: 'Hang', prompt: 'wait here' });
      runner.enqueue({ title: 'Later', prompt: 'do not start' });
      const done = runner.start();
      await waitFor(() => runner.list()[0]?.status === 'running');
      expect(runner.snapshot().runState === 'running', 'running state');
      runner.stop();
      await done;
      const tasks = runner.list();
      expect(tasks[0].status === 'blocked', `stopped status ${tasks[0].status} ${tasks[0].reason}`);
      expect((tasks[0].reason || '').includes('Stopped'), tasks[0].reason || 'stop reason');
      expect(tasks[1].status === 'pending', `later was started ${tasks[1].status}`);
      expect(fetches <= 1, `fetches after stop ${fetches}`);
      expect(runner.snapshot().runState === 'idle', 'idle after stop');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testPause() {
  await withRoot(async (root) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const blob = String(init?.body);
      if (blob.includes('TASK_SLOW') && !blob.includes('OBSERVE:')) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return new Response(ndjson('FINAL: paused queue'), { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root));
      runner.enqueue({ title: 'Slow', prompt: 'TASK_SLOW first' });
      runner.enqueue({ title: 'Held', prompt: 'TASK_HELD second' });
      const done = runner.start();
      await waitFor(() => runner.list().some((task) => task.title === 'Slow' && task.status === 'running'));
      runner.pause();
      expect(runner.snapshot().runState === 'paused', 'pause state');
      await done;
      const slow = runner.list().find((task) => task.title === 'Slow');
      const held = runner.list().find((task) => task.title === 'Held');
      expect(slow?.status === 'done', `slow ${slow?.status} ${slow?.reason}`);
      expect(held?.status === 'pending', `held ${held?.status}`);
      expect(runner.snapshot().runState === 'idle', 'idle after pause');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testWallAndPaid() {
  await withRoot(async (root) => {
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const blob = String(init?.body);
      if (blob.includes('TASK_AFTER_WALL')) return new Response(ndjson('FINAL: after the wall'), { status: 200 });
      fetches += 1;
      await new Promise<void>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
      });
      return new Response('no', { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root), { maxWallMs: 300 });
      runner.enqueue({ title: 'Slow model', prompt: 'take too long' });
      runner.enqueue({ title: 'Still next', prompt: 'TASK_AFTER_WALL' });
      await runner.start();
      const tasks = runner.list();
      expect(tasks[0].status === 'failed', `wall ${tasks[0].status} ${tasks[0].reason}`);
      expect((tasks[0].reason || '').includes('Wall time'), tasks[0].reason || 'wall reason');
      expect(tasks[1].status === 'done', `after wall ${tasks[1].status} ${tasks[1].reason}`);
    } finally {
      globalThis.fetch = original;
    }

    fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return new Response(ndjson('FINAL: billed'), { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root), {
        llm: { host: 'https://api.openai.com', model: 'gpt-4o', allowPaidApis: false },
      });
      runner.enqueue({ title: 'Paid', prompt: 'use a paid model' });
      await runner.start();
      const task = runner.list().find((item) => item.title === 'Paid');
      expect(!!task, 'paid task missing');
      expect(task.status === 'failed', `paid ${task.status}`);
      expect((task.reason || '').includes('Paid') || (task.reason || '').includes('paid'), task.reason || 'paid reason');
      expect(fetches === 0, `paid fetch was called ${fetches}`);
      expect(runner.snapshot().allowPaidApis === false, 'snapshot shows paid disabled');
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function testQueueFile() {
  await withRoot(async (root) => {
    const dir = path.join(root, '.jewbot');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'cascade.json');
    const id = 'task_' + 'a'.repeat(32);
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id,
            title: 'Crashed',
            prompt: 'resume me',
            status: 'running',
            createdAt: '2026-11-02T00:00:00.000Z',
            updatedAt: '2026-11-02T00:00:00.000Z',
          },
        ],
      }),
    );
    const resumed = runnerFor(root, freshSsh(root));
    expect(resumed.list()[0]?.status === 'pending', `running was not reset ${resumed.list()[0]?.status}`);
    const saved = JSON.parse(await fs.promises.readFile(file, 'utf8')) as { tasks: Array<{ status: string }> };
    expect(saved.tasks[0].status === 'pending', 'queue file no longer says running');

    await fs.promises.writeFile(file, '{');
    const broken = runnerFor(root, freshSsh(root));
    expect((broken.snapshot().error || '').includes('JSON'), broken.snapshot().error || 'missing error');
    let threw = false;
    try {
      broken.enqueue({ title: 'Nope', prompt: 'should not write' });
    } catch {
      threw = true;
    }
    expect(threw, 'enqueue on a broken queue should fail');
    expect((await fs.promises.readFile(file, 'utf8')) === '{', 'broken queue file was overwritten');
  });
}

async function testMaxSteps() {
  await withRoot(async (root) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const blob = String(init?.body);
      if (blob.includes('TASK_AFTER_STEPS')) return new Response(ndjson('FINAL: after the step cap'), { status: 200 });
      return new Response(ndjson('still thinking'), { status: 200 });
    };
    try {
      const runner = runnerFor(root, freshSsh(root), { maxSteps: 2 });
      runner.enqueue({ title: 'Loops', prompt: 'never finish' });
      runner.enqueue({ title: 'After cap', prompt: 'TASK_AFTER_STEPS continue' });
      await runner.start();
      const tasks = runner.list();
      expect(tasks[0].status === 'failed', `steps ${tasks[0].status} ${tasks[0].reason}`);
      expect((tasks[0].reason || '').includes('max steps'), tasks[0].reason || 'steps reason');
      expect(tasks[1].status === 'done', `after cap ${tasks[1].status} ${tasks[1].reason}`);
    } finally {
      globalThis.fetch = original;
    }
  });
}

async function main() {
  await testAutoAdvance();
  await testBlockedThenSkip();
  await testAcceptance();
  await testStop();
  await testPause();
  await testWallAndPaid();
  await testMaxSteps();
  await testQueueFile();
  console.log('smoke-m6: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
