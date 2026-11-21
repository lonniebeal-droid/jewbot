/**
 * Local git panel. Status, diffs, stage, commit, and branch switch run
 * without a network. Push, reset, and clean wait for the existing confirm
 * grant and are never started by commit. Commit messages can be drafted
 * on local Ollama after assertLocalSpendOnly.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { checkShellCommand, consumeConfirmation } from '../safety';
import { assertLocalSpendOnly } from '../safety';
import { chatOnce } from '../llm/ollama';
import { assertRoutableOllamaHost } from '../llm/route';

const exec = promisify(execFile);

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Jewbot',
  GIT_AUTHOR_EMAIL: 'jewbot@localhost',
  GIT_COMMITTER_NAME: 'Jewbot',
  GIT_COMMITTER_EMAIL: 'jewbot@localhost',
};

export type GitAction = 'status' | 'diff' | 'stage' | 'unstage' | 'commit' | 'switch' | 'push' | 'reset' | 'clean';

export interface GitResult {
  ok: boolean;
  action: GitAction;
  command: string;
  stdout: string;
  stderr: string;
  needsConfirmation?: boolean;
  reason?: string;
}

const GUARDED: GitAction[] = ['push', 'reset', 'clean'];

export function gitCommand(action: GitAction, args: string[] = []): string[] {
  switch (action) {
    case 'status':
      return ['status', '--porcelain=v1', '--branch'];
    case 'diff':
      return args[0] === '--cached' ? ['diff', '--cached', '--', ...args.slice(1)] : ['diff', '--', ...args];
    case 'stage':
      return ['add', '--', ...args];
    case 'unstage':
      return ['restore', '--staged', '--', ...args];
    case 'commit':
      return ['commit', '-m', args[0] || 'Update files'];
    case 'switch':
      return ['switch', args[0] || ''];
    case 'push':
      return ['push', ...args];
    case 'reset':
      return ['reset', ...args];
    case 'clean':
      return ['clean', ...args];
    default:
      throw new Error(`Unknown git action`);
  }
}

export function renderGitCommand(action: GitAction, args: string[] = []): string {
  return ['git', ...gitCommand(action, args)].join(' ');
}

export async function runGit(root: string, action: GitAction, args: string[] = [], executionId?: string): Promise<GitResult> {
  const argv = gitCommand(action, args);
  const command = ['git', ...argv].join(' ');
  if (GUARDED.includes(action) || !checkShellCommand(command).ok) {
    if (!consumeConfirmation(executionId, command)) {
      const decision = checkShellCommand(command);
      return {
        ok: false,
        action,
        command,
        stdout: '',
        stderr: '',
        needsConfirmation: true,
        reason: decision.ok ? 'This git command waits for the owner.' : decision.reason,
      };
    }
  }
  try {
    const result = await exec('git', argv, {
      cwd: root,
      env: { ...process.env, ...GIT_ENV },
      timeout: 15_000,
    });
    return { ok: true, action, command, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      action,
      command,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || 'git failed',
    };
  }
}

export async function suggestCommitMessage(diffText: string, host = 'http://127.0.0.1:11434'): Promise<string> {
  const normalized = assertRoutableOllamaHost(host);
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Commit messages keep the spend gate closed.');
  const answer = await chatOnce(
    [
      { role: 'system', content: 'Write a one-line git commit subject. Do not push. Do not use a paid API.' },
      { role: 'user', content: diffText.slice(0, 4000) },
    ],
    { host: normalized, model: process.env.JEWBOT_MODEL || 'qwen2.5-coder:7b', allowPaidApis: false, allowPrivateLan: true },
  );
  return answer.trim().split('\n')[0].slice(0, 72);
}
