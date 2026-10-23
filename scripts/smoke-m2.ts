/**
 * M2 smoke: safety gate on the terminal, streamed stdout/stderr, kill, agent run_terminal.
 * No network. No paid APIs. Destructive commands run only after this test issues a grant,
 * and only against a temp directory.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { issueConfirmation, resetConfirmations } from '../src/modules/safety';
import { defaultSshManager } from '../src/modules/ssh';
import { resolveBackend, TerminalSession } from '../src/modules/terminal';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    expect(re.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

async function testTerminal() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m2-'));
  const term = new TerminalSession();
  const savedBackend = process.env.JEWBOT_TERMINAL_BACKEND;
  process.env.JEWBOT_TERMINAL_BACKEND = 'child_process';
  try {
    expect(resolveBackend() === 'child_process', `backend ${resolveBackend()}`);

    const chunks: string[] = [];
    const echo = await term.run('echo jewbot-m2 && echo err-line >&2', {
      cwd: root,
      projectRoot: root,
      onChunk: (chunk) => chunks.push(`${chunk.stream}:${chunk.text}`),
    });
    expect(echo.exitCode === 0, `echo exit ${echo.exitCode} stderr=${echo.stderr}`);
    expect(echo.stdout.includes('jewbot-m2'), `stdout ${JSON.stringify(echo.stdout)}`);
    expect(echo.stderr.includes('err-line'), `stderr ${JSON.stringify(echo.stderr)}`);
    expect(echo.killed === false && echo.timedOut === false, 'echo not killed');
    expect(chunks.some((c) => c.startsWith('stdout:') && c.includes('jewbot-m2')), `stdout chunk ${chunks.join('|')}`);
    expect(chunks.some((c) => c.startsWith('stderr:') && c.includes('err-line')), `stderr chunk ${chunks.join('|')}`);
    expect(echo.backend === 'child_process', 'child_process backend');

    const times: number[] = [];
    const startedAt = Date.now();
    const streamed = await term.run('echo one; sleep 0.35; echo two', {
      cwd: root,
      projectRoot: root,
      timeoutMs: 5000,
      onChunk: (chunk) => {
        if (chunk.stream === 'stdout' && chunk.text.includes('one')) times.push(Date.now() - startedAt);
      },
    });
    expect(streamed.stdout.includes('one') && streamed.stdout.includes('two'), `stream body ${streamed.stdout}`);
    expect(times.length >= 1 && times[0] < 300, `first chunk should arrive before sleep ends, at ${times[0]}`);

    const outside = path.resolve(root, '..');
    await expectThrow(
      () => term.run('echo nope', { cwd: outside, projectRoot: root }),
      /escapes project root/,
      'cwd jail',
    );

    const victim = path.join(root, 'victim');
    await fs.writeFile(victim, 'keep');
    const destructive = `echo kept && rm -rf ${victim}`;
    await expectThrow(
      () => term.run(destructive, { cwd: root, projectRoot: root, approved: true, executionId: 'shell-test-12345678' }),
      /safety|confirmation|Destructive/,
      'caller-supplied approval does not run rm -rf',
    );
    expect(await fs.readFile(victim, 'utf8') === 'keep', 'victim survived unapproved rm');

    resetConfirmations();
    const { executionId } = issueConfirmation(destructive);
    const removed = await term.run(destructive, { cwd: root, projectRoot: root, executionId });
    expect(removed.exitCode === 0, `approved rm exit ${removed.exitCode} ${removed.stderr}`);
    await expectThrow(() => fs.stat(victim), /ENOENT/, 'victim removed only after grant');
    await expectThrow(
      () => term.run(destructive, { cwd: root, projectRoot: root, executionId }),
      /safety|confirmation|Destructive/,
      'grant cannot be reused',
    );

    const sleep = term.start('sleep 30', { cwd: root, projectRoot: root, timeoutMs: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(term.kill(sleep.sessionId), 'kill returns true');
    const killed = await sleep.done;
    expect(killed.killed, 'session marked killed');
    expect(Date.now() - startedAt < 7000, 'kill returned before the sleep command finished');
    expect(term.kill(sleep.sessionId) === false, 'second kill is a no-op');
  } finally {
    term.killAll();
    if (savedBackend === undefined) delete process.env.JEWBOT_TERMINAL_BACKEND;
    else process.env.JEWBOT_TERMINAL_BACKEND = savedBackend;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testAgentTerminal() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m2-agent-'));
  const savedBackend = process.env.JEWBOT_TERMINAL_BACKEND;
  process.env.JEWBOT_TERMINAL_BACKEND = 'child_process';
  const original = globalThis.fetch;
  try {
    await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n');
    const victim = path.join(root, 'victim-dir');
    await fs.mkdir(victim);
    const files = new FileWorkspace(root);
    const term = new TerminalSession();

    const destructive = `rm -rf ${victim}`;
    let asked = 0;
    let step = 0;
    const denyScript = [
      JSON.stringify({
        tool: 'run_terminal',
        args: { command: destructive, approved: true, executionId: 'attacker-supplied' },
      }),
      'FINAL: stopped',
    ];
    globalThis.fetch = async () => {
      const content = denyScript[Math.min(step, denyScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const denied = new AgentLoop({
      files,
      terminal: term,
      ssh: defaultSshManager,
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 4,
      confirmDestructive: async () => {
        asked += 1;
        return false;
      },
    });
    const deniedResult = await denied.run('remove the victim directory');
    expect(deniedResult.status === 'done', `denied status ${deniedResult.status} ${deniedResult.blockReason ?? ''}`);
    expect(asked === 1, `confirm asked once, got ${asked}`);
    expect(deniedResult.finalText === 'stopped', `final ${deniedResult.finalText}`);
    const deniedObs = deniedResult.steps.map((s) => s.observation || '').join('\n');
    expect(deniedObs.includes('BLOCKED'), `observation should say blocked: ${deniedObs}`);
    expect((await fs.stat(victim)).isDirectory(), 'declined confirm did not delete');

    step = 0;
    const echoScript = [
      JSON.stringify({ tool: 'run_terminal', args: { command: 'echo from-agent' } }),
      'FINAL: saw from-agent',
    ];
    globalThis.fetch = async () => {
      const content = echoScript[Math.min(step, echoScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const events: string[] = [];
    const agent = new AgentLoop({
      files,
      terminal: term,
      ssh: defaultSshManager,
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 4,
    });
    let final = '';
    for await (const ev of agent.runStream('echo something')) {
      if (ev.type === 'terminal_chunk') events.push(ev.text);
      if (ev.type === 'done') final = ev.result.finalText || ev.result.blockReason || ev.result.status;
    }
    expect(events.some((text) => text.includes('from-agent')), `streamed chunks ${JSON.stringify(events)}`);
    expect(final === 'saw from-agent', `agent final ${final}`);

    step = 0;
    asked = 0;
    const allowScript = [
      JSON.stringify({ tool: 'run_terminal', args: { command: destructive, approved: true, executionId: 'nope' } }),
      'FINAL: removed',
    ];
    globalThis.fetch = async () => {
      const content = allowScript[Math.min(step, allowScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const allowed = new AgentLoop({
      files,
      terminal: new TerminalSession(),
      ssh: defaultSshManager,
      context: new ContextIndexer(root),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 4,
      confirmDestructive: async (req) => {
        asked += 1;
        expect(req.command === destructive, 'confirm sees the real command');
        expect(req.category === 'destructive_shell', `category ${req.category}`);
        return true;
      },
    });
    const allowedResult = await allowed.run('remove victim after I confirm');
    expect(asked === 1, 'owner confirm called');
    expect(allowedResult.status === 'done', `allowed status ${allowedResult.status} ${allowedResult.blockReason ?? ''}`);
    await expectThrow(() => fs.stat(victim), /ENOENT/, 'ran only after confirm returned true');
    const obs = allowedResult.steps.map((s) => s.observation || '').join('\n');
    expect(obs.includes('exit_code: 0'), `observation ${obs}`);
  } finally {
    globalThis.fetch = original;
    if (savedBackend === undefined) delete process.env.JEWBOT_TERMINAL_BACKEND;
    else process.env.JEWBOT_TERMINAL_BACKEND = savedBackend;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  await testTerminal();
  await testAgentTerminal();
  console.log('smoke-m2: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
