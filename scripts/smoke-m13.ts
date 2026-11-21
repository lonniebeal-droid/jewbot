/**
 * M13 git panel smoke. Temp repo. Suggested messages mock Ollama.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { issueConfirmation, resetConfirmations } from '../src/modules/safety';
import { renderGitCommand, runGit, suggestCommitMessage } from '../src/modules/git';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m13-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, env: process.env });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'jewbot@localhost']);
  git(['config', 'user.name', 'Jewbot']);
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello\n');
  git(['add', 'note.txt']);
  git(['commit', '-m', 'init']);
  return root;
}

async function testStatusStageCommitSwitch() {
  const root = repo();
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello world\n');
  const status = await runGit(root, 'status');
  expect(status.ok && status.stdout.includes('note.txt'), status.stdout);
  const unstaged = await runGit(root, 'diff', ['note.txt']);
  expect(unstaged.stdout.includes('hello world'), 'unstaged diff');
  const stagedBefore = await runGit(root, 'diff', ['--cached', 'note.txt']);
  expect(!stagedBefore.stdout.includes('hello world'), 'nothing staged yet');
  const staged = await runGit(root, 'stage', ['note.txt']);
  expect(staged.ok, staged.stderr);
  const stagedDiff = await runGit(root, 'diff', ['--cached', 'note.txt']);
  expect(stagedDiff.stdout.includes('hello world'), 'staged diff');
  const unstage = await runGit(root, 'unstage', ['note.txt']);
  expect(unstage.ok, unstage.stderr);
  await runGit(root, 'stage', ['note.txt']);
  const committed = await runGit(root, 'commit', ['edit note']);
  expect(committed.ok, committed.stderr || committed.stdout);
  const log = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root }).toString().trim();
  expect(log === 'edit note', log);
  execFileSync('git', ['branch', 'topic'], { cwd: root });
  const switched = await runGit(root, 'switch', ['topic']);
  expect(switched.ok, switched.stderr);
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim();
  expect(branch === 'topic', branch);
}

async function testGuardedCommands() {
  resetConfirmations();
  const root = repo();
  const push = await runGit(root, 'push', ['origin', 'main']);
  expect(push.ok === false && push.needsConfirmation === true, 'push waits');
  expect(!push.stdout.includes('Everything'), 'push did not run');
  const command = renderGitCommand('push', ['--force', 'origin', 'main']);
  const bare = await runGit(root, 'push', ['--force', 'origin', 'main']);
  expect(bare.needsConfirmation === true, 'force push waits');
  const grant = issueConfirmation(command);
  const allowed = await runGit(root, 'push', ['--force', 'origin', 'main'], grant.executionId);
  expect(allowed.needsConfirmation !== true, 'grant is consumed');
  const reset = await runGit(root, 'reset', ['--hard']);
  expect(reset.needsConfirmation === true, 'reset waits');
  const clean = await runGit(root, 'clean', ['-fd']);
  expect(clean.needsConfirmation === true, 'clean waits');
  const commit = await runGit(root, 'commit', ['nope']);
  expect(commit.needsConfirmation !== true, 'commit does not ask to push');
}

async function testSuggestMessage() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(url === 'http://127.0.0.1:11434/api/chat', url);
    return new Response(JSON.stringify({ message: { role: 'assistant', content: 'Explain the note\n' }, done: true }) + '\n', { status: 200 });
  };
  try {
    const message = await suggestCommitMessage('diff --git a/note.txt\n+hello\n');
    expect(message === 'Explain the note', message);
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error('no');
    };
    let refused = false;
    try {
      await suggestCommitMessage('diff', 'https://api.openai.com/v1');
    } catch (err) {
      refused = /Refusing/.test(err instanceof Error ? err.message : String(err));
    }
    expect(refused && fetches === 0, 'paid host is not fetched');
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  await testStatusStageCommitSwitch();
  await testGuardedCommands();
  await testSuggestMessage();
  console.log('smoke-m13: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
