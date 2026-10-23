/**
 * Local terminal: spawn a shell, capture stdout/stderr, stream chunks, kill the session.
 *
 * Default backend is `child_process` so the two streams stay separate (headless-friendly).
 * `node-pty` is used when JEWBOT_TERMINAL_BACKEND=pty and the optional module loads.
 * A PTY merges stdout and stderr into one stream; that data is reported as stdout.
 *
 * Destructive commands do not run unless `executionId` is a one-shot grant from
 * `issueConfirmation` (the confirm dialog). `approved: true` on its own never runs them.
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { checkShellCommand, consumeConfirmation, redactSecrets, SafetyDecision } from '../safety';

export interface TerminalResult {
  sessionId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  killed: boolean;
  backend: TerminalBackend;
}

export type TerminalBackend = 'pty' | 'child_process';

export interface TerminalChunk {
  sessionId: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface RunOptions {
  cwd?: string;
  /** When set, `cwd` must stay inside this directory. */
  projectRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onChunk?: (chunk: TerminalChunk) => void;
  /**
   * Ignored unless it is a live server-issued grant for this exact command.
   * Model- or caller-supplied ids do not authorize destructive commands.
   */
  executionId?: string;
  /** Accepted for older call sites. Does not authorize destructive commands. */
  approved?: boolean;
  requireApproval?: boolean;
}

export interface StartedSession {
  sessionId: string;
  backend: TerminalBackend;
  done: Promise<TerminalResult>;
}

export interface TerminalStartResult {
  ok: boolean;
  started: boolean;
  sessionId?: string;
  backend?: TerminalBackend;
  needsConfirmation?: boolean;
  reason?: string;
  category?: string;
  pattern?: string;
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[],
    opts: { name?: string; cols?: number; rows?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => {
    pid: number;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
    kill: (signal?: string) => void;
  };
}

interface LiveSession {
  id: string;
  command: string;
  backend: TerminalBackend;
  pid: number | undefined;
  killed: boolean;
  exited: boolean;
  timedOut: boolean;
  kill: (signal: NodeJS.Signals) => void;
  timer?: NodeJS.Timeout;
  hardKill?: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024;

export function ptyAvailable(): boolean {
  return loadPty() !== null;
}

export function resolveBackend(): TerminalBackend {
  const forced = process.env.JEWBOT_TERMINAL_BACKEND;
  if (forced === 'child_process') return 'child_process';
  if (forced === 'pty') return ptyAvailable() ? 'pty' : 'child_process';
  return 'child_process';
}

export function formatTerminalObservation(result: Pick<TerminalResult, 'exitCode' | 'stdout' | 'stderr' | 'timedOut' | 'truncated' | 'killed'>): string {
  const lines = [
    `exit_code: ${result.exitCode === null ? 'null' : String(result.exitCode)}`,
    `timed_out: ${result.timedOut}`,
    `truncated: ${result.truncated}`,
    `killed: ${result.killed}`,
  ];
  if (result.stdout) lines.push('stdout:', result.stdout.trimEnd());
  if (result.stderr) lines.push('stderr:', result.stderr.trimEnd());
  return lines.join('\n');
}

export class TerminalSession extends EventEmitter {
  private sessions = new Map<string, LiveSession>();

  /**
   * Classify only. Never spawns. Destructive commands come back as
   * needsConfirmation so the UI can ask before `start`.
   */
  prepare(command: string): TerminalStartResult {
    const decision = classifyForExec(command);
    if (decision.ok) return { ok: true, started: false };
    return {
      ok: false,
      started: false,
      needsConfirmation: decision.needsConfirmation,
      reason: decision.reason,
      category: decision.category,
      pattern: decision.pattern,
    };
  }

  /** Spawn and return immediately. `done` resolves when the process exits. */
  start(command: string, opts: RunOptions = {}): StartedSession {
    assertAllowed(command, opts);
    const cwd = resolveCwd(opts);
    const backend = resolveBackend();
    const sessionId = randomUUID();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_BYTES;

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settle!: (result: TerminalResult) => void;
    let reject!: (err: Error) => void;
    const done = new Promise<TerminalResult>((resolve, rejectPromise) => {
      settle = resolve;
      reject = rejectPromise;
    });

    const live: LiveSession = {
      id: sessionId,
      command,
      backend,
      pid: undefined,
      killed: false,
      exited: false,
      timedOut: false,
      kill: () => undefined,
    };
    this.sessions.set(sessionId, live);

    const finish = (exitCode: number | null) => {
      if (live.exited) return;
      live.exited = true;
      if (live.timer) clearTimeout(live.timer);
      if (live.hardKill) clearTimeout(live.hardKill);
      this.sessions.delete(sessionId);
      const result: TerminalResult = {
        sessionId,
        exitCode,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        timedOut: live.timedOut,
        truncated,
        killed: live.killed,
        backend,
      };
      this.emit('exit', result);
      settle(result);
    };

    const push = (stream: 'stdout' | 'stderr', text: string) => {
      const redacted = redactSecrets(text);
      const chunk: TerminalChunk = { sessionId, stream, text: redacted };
      this.emit('data', chunk);
      opts.onChunk?.(chunk);
      const bucket = stream === 'stdout' ? stdout : stderr;
      if (bucket.length >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const next = bucket + redacted;
      if (next.length > maxOutputBytes) {
        truncated = true;
        if (stream === 'stdout') stdout = next.slice(0, maxOutputBytes);
        else stderr = next.slice(0, maxOutputBytes);
      } else if (stream === 'stdout') stdout = next;
      else stderr = next;
    };

    let child: ChildProcess | null = null;
    let pty: ReturnType<PtyModule['spawn']> | null = null;

    try {
      if (backend === 'pty') {
        const mod = loadPty();
        if (!mod) throw new Error('node-pty is not installed');
        pty = mod.spawn(shellFile(), ['-c', command], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd,
          env: shellEnv(opts.env),
        });
        live.pid = pty.pid;
        live.kill = (signal) => {
          try {
            pty?.kill(signal);
          } catch {
            /* already gone */
          }
        };
        pty.onData((data) => push('stdout', data));
        pty.onExit(({ exitCode }) => finish(exitCode));
      } else {
        const launched = spawnCaptured(command, cwd, shellEnv(opts.env));
        child = launched.child;
        live.pid = child.pid;
        live.kill = (signal) => killTree(child?.pid, signal);
        child.stdout?.on('data', (buf: Buffer) => push('stdout', buf.toString('utf8')));
        child.stderr?.on('data', (buf: Buffer) => push('stderr', buf.toString('utf8')));
        child.on('error', (err) => {
          if (live.exited) return;
          live.exited = true;
          if (live.timer) clearTimeout(live.timer);
          this.sessions.delete(sessionId);
          reject(err);
        });
        child.on('close', (code) => finish(code));
      }
    } catch (err) {
      this.sessions.delete(sessionId);
      reject(err instanceof Error ? err : new Error(String(err)));
      return { sessionId, backend, done };
    }

    live.timer = setTimeout(() => {
      live.timedOut = true;
      live.killed = true;
      live.kill('SIGKILL');
    }, timeoutMs);

    if (opts.signal) {
      const abort = () => {
        if (live.exited) return;
        live.killed = true;
        this.kill(sessionId);
      };
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener('abort', abort, { once: true });
    }

    return { sessionId, backend, done };
  }

  async run(command: string, opts: RunOptions = {}): Promise<TerminalResult> {
    const started = this.start(command, opts);
    return started.done;
  }

  /** SIGTERM the session, then SIGKILL if it is still alive. */
  kill(sessionId: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live || live.exited) return false;
    live.killed = true;
    live.kill('SIGTERM');
    if (live.hardKill) clearTimeout(live.hardKill);
    live.hardKill = setTimeout(() => {
      if (!live.exited) live.kill('SIGKILL');
    }, 1000);
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}

export const defaultTerminal = new TerminalSession();

function classifyForExec(command: string): SafetyDecision {
  return checkShellCommand(command, { requireApproval: false });
}

function assertAllowed(command: string, opts: RunOptions): void {
  const decision = classifyForExec(command);
  if (decision.ok) return;
  if (decision.needsConfirmation && consumeConfirmation(opts.executionId, command)) return;
  const err = new Error(`[safety] ${decision.reason}`);
  (err as Error & { decision?: SafetyDecision }).decision = decision;
  throw err;
}

function resolveCwd(opts: RunOptions): string {
  const root = opts.projectRoot ? path.resolve(opts.projectRoot) : opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const cwd = opts.cwd ? path.resolve(root, opts.cwd) : root;
  if (opts.projectRoot) {
    const resolvedRoot = path.resolve(opts.projectRoot);
    if (cwd !== resolvedRoot && !cwd.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`[safety] cwd escapes project root: ${opts.cwd ?? cwd}`);
    }
  }
  return cwd;
}

function shellFile(): string {
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

function shellEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

function spawnCaptured(command: string, cwd: string, env: NodeJS.ProcessEnv): { child: ChildProcess } {
  const file = shellFile();
  const stdbuf = stdbufPath();
  const spawnOpts = {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  if (stdbuf) return { child: spawn(stdbuf, ['-oL', '-eL', file, '-c', command], spawnOpts) };
  return { child: spawn(file, ['-c', command], spawnOpts) };
}

function stdbufPath(): string | null {
  for (const candidate of ['/usr/bin/stdbuf', '/bin/stdbuf']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already exited */
    }
  }
}

function loadPty(): PtyModule | null {
  try {
    // Optional native module. Missing or failing to load falls back to child_process.
    return require('node-pty') as PtyModule;
  } catch {
    return null;
  }
}
