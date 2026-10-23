/**
 * Local terminal control: exec, capture stdout/stderr, stream output.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { checkShellCommand, redactSecrets } from '../safety';

export interface TerminalResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  approved?: boolean;
  executionId?: string;
  requireApproval?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class TerminalSession extends EventEmitter {
  async run(command: string, opts: RunOptions = {}): Promise<TerminalResult> {
    const decision = checkShellCommand(command, {
      approved: opts.approved,
      executionId: opts.executionId,
      requireApproval: opts.requireApproval ?? false,
    });
    if (!decision.ok) {
      throw new Error(`[safety] ${decision.reason}`);
    }

    const timeoutMs = opts.timeoutMs ?? 60_000;
    const maxOutputBytes = opts.maxOutputBytes ?? 64 * 1024;
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', command], {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      const onChunk = (name: 'stdout' | 'stderr', buf: Buffer) => {
        const text = buf.toString('utf8');
        this.emit('data', { stream: name, text });
        if (name === 'stdout') {
          if (stdout.length < maxOutputBytes) stdout += text.slice(0, maxOutputBytes - stdout.length);
          else truncated = true;
        } else {
          if (stderr.length < maxOutputBytes) stderr += text.slice(0, maxOutputBytes - stderr.length);
          else truncated = true;
        }
      };

      child.stdout?.on('data', (b: Buffer) => onChunk('stdout', b));
      child.stderr?.on('data', (b: Buffer) => onChunk('stderr', b));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout: redactSecrets(stdout),
          stderr: redactSecrets(stderr),
          timedOut,
          truncated,
        });
      });
    });
  }
}

export const defaultTerminal = new TerminalSession();
