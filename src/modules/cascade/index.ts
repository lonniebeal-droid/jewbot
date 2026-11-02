/**
 * Cascade runner: a local task queue that finishes one task and starts the next.
 *
 * The queue lives in `<project>/.jewbot/cascade.json` (gitignored). Each task is
 * sent through the agent loop. On success, an optional acceptance command runs
 * in the terminal module. A human gate (destructive command, file-edit Accept,
 * SSH host key / secret, ask_owner) is never self-approved: the task is marked
 * blocked, a receipt is written, and the runner moves on to the next pending task.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { AgentLoop, AgentRunResult, AgentStep } from '../agent';
import { ContextIndexer } from '../context';
import { FileWorkspace } from '../files';
import { OllamaConfig, assertOllamaAllowed, defaultOllamaConfig } from '../llm';
import { redactSecrets } from '../safety';
import { SshManager } from '../ssh';
import { TerminalResult, TerminalSession } from '../terminal';

export type CascadeTaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'failed';

export type CascadeRunState = 'idle' | 'running' | 'paused';

export interface CascadeTask {
  id: string;
  title: string;
  prompt: string;
  status: CascadeTaskStatus;
  /** Shell command. Exit 0 is required after the agent finishes. Omitted when unset. */
  acceptance?: string;
  /** Why the task is blocked or failed. */
  reason?: string;
  /** Project-relative receipt path, posix. */
  receipt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface CascadeStepSummary {
  n: number;
  tool?: string;
  args?: Record<string, unknown>;
  observation?: string;
  thought?: string;
}

export interface CascadeAcceptanceSummary {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  killed: boolean;
}

export interface CascadeAgentOutcome {
  status: 'done' | 'blocked' | 'failed';
  reason?: string;
  finalText?: string;
  steps: CascadeStepSummary[];
  acceptance?: CascadeAcceptanceSummary;
}

export interface CascadeSnapshot {
  runState: CascadeRunState;
  tasks: CascadeTask[];
  error: string | null;
  maxSteps: number;
  maxWallMs: number;
  allowPaidApis: boolean;
}

export interface CascadeEnqueueInput {
  title: string;
  prompt: string;
  acceptance?: string;
}

export interface CascadeDeps {
  /** Open project. Agent tools and the acceptance command use this directory. */
  projectRoot: string;
  /** Where `.jewbot/` is written. Defaults to projectRoot. */
  storeRoot?: string;
  files: FileWorkspace;
  terminal: TerminalSession;
  ssh: SshManager;
  context: ContextIndexer;
  llm?: OllamaConfig;
  maxSteps?: number;
  maxWallMs?: number;
  /**
   * Replaces the agent loop. Tests and the UI smoke pass a scripted executor.
   * Production leaves this unset so tasks go through Ollama.
   */
  execute?: (task: CascadeTask, signal: AbortSignal) => Promise<CascadeAgentOutcome>;
}

const QUEUE_VERSION = 1;
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_WALL_MS = 3 * 60 * 1000;
const MAX_TASKS = 100;
const MAX_TITLE = 160;
const MAX_PROMPT = 20_000;
const MAX_ACCEPTANCE = 4_000;
const MAX_REASON = 2_000;
const RECEIPT_OBS_CHARS = 1_200;
const RECEIPT_OUT_CHARS = 2_000;
const ID_RE = /^task_[a-f0-9]{32}$/;
const STATUSES: readonly CascadeTaskStatus[] = ['pending', 'running', 'done', 'blocked', 'failed'];

type AbortCause = 'stop' | 'wall' | 'gate' | null;

export class CascadeRunner extends EventEmitter {
  private tasks: CascadeTask[] = [];
  private loadError: string | null = null;
  private projectRoot: string;
  private storeRoot: string;
  private files: FileWorkspace;
  private terminal: TerminalSession;
  private ssh: SshManager;
  private context: ContextIndexer;
  private llm?: OllamaConfig;
  private readonly executeOverride?: CascadeDeps['execute'];
  private readonly maxSteps: number;
  private readonly maxWallMs: number;
  private runState: CascadeRunState = 'idle';
  private pauseRequested = false;
  private stopped = false;
  private generation = 0;
  private loop: Promise<void> | null = null;
  private inflight: AbortController | null = null;
  private abortCause: AbortCause = null;
  private gateReason: string | null = null;

  constructor(deps: CascadeDeps) {
    super();
    this.projectRoot = path.resolve(deps.projectRoot);
    this.storeRoot = path.resolve(deps.storeRoot ?? deps.projectRoot);
    this.files = deps.files;
    this.terminal = deps.terminal;
    this.ssh = deps.ssh;
    this.context = deps.context;
    this.llm = deps.llm;
    this.executeOverride = deps.execute;
    this.maxSteps = clampInt(deps.maxSteps ?? envInt('JEWBOT_CASCADE_MAX_STEPS', DEFAULT_MAX_STEPS), 1, 24);
    this.maxWallMs = clampInt(deps.maxWallMs ?? envInt('JEWBOT_CASCADE_MAX_MS', DEFAULT_MAX_WALL_MS), 50, 30 * 60 * 1000);
    this.load();
  }

  /** Point the queue and the agent at another project. Stops the current run. */
  setWorkspace(next: { projectRoot: string; files: FileWorkspace; context: ContextIndexer; storeRoot?: string }): void {
    this.generation += 1;
    this.stopped = true;
    this.pauseRequested = false;
    this.inflight?.abort();
    this.projectRoot = path.resolve(next.projectRoot);
    this.storeRoot = path.resolve(next.storeRoot ?? next.projectRoot);
    this.files = next.files;
    this.context = next.context;
    this.load();
    this.publish();
  }

  snapshot(): CascadeSnapshot {
    const cfg = this.llmConfig();
    return {
      runState: this.runState,
      tasks: this.tasks.map(cloneTask),
      error: this.loadError,
      maxSteps: this.maxSteps,
      maxWallMs: this.maxWallMs,
      allowPaidApis: cfg.allowPaidApis,
    };
  }

  list(): CascadeTask[] {
    return this.tasks.map(cloneTask);
  }

  enqueue(input: CascadeEnqueueInput): CascadeTask {
    if (this.loadError) throw new Error(this.loadError);
    if (this.tasks.length >= MAX_TASKS) throw new Error(`Cascade queue is full (${MAX_TASKS}).`);
    const title = cleanLine(input.title, MAX_TITLE, 'title');
    const prompt = cleanText(input.prompt, MAX_PROMPT, 'prompt');
    const acceptance = cleanAcceptance(input.acceptance);
    const now = new Date().toISOString();
    const task: CascadeTask = {
      id: newTaskId(),
      title,
      prompt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (acceptance) task.acceptance = acceptance;
    this.tasks.push(task);
    this.save();
    this.publish();
    return cloneTask(task);
  }

  remove(id: string): boolean {
    const task = this.find(id);
    if (!task || task.status === 'running') return false;
    this.tasks = this.tasks.filter((item) => item.id !== id);
    this.save();
    this.publish();
    return true;
  }

  /** Put a blocked or failed task back on the queue. Does not approve anything. */
  requeue(id: string): CascadeTask | null {
    const task = this.find(id);
    if (!task || (task.status !== 'blocked' && task.status !== 'failed')) return null;
    task.status = 'pending';
    delete task.reason;
    delete task.startedAt;
    delete task.finishedAt;
    task.updatedAt = new Date().toISOString();
    this.save();
    this.publish();
    return cloneTask(task);
  }

  /** Run pending tasks until the queue is idle, paused, or stopped. */
  start(): Promise<void> {
    if (this.loop) return this.loop;
    if (this.loadError) return Promise.reject(new Error(this.loadError));
    this.stopped = false;
    this.pauseRequested = false;
    this.runState = 'running';
    this.publish();
    const gen = this.generation;
    this.loop = this.runLoop(gen).finally(() => {
      this.loop = null;
      if (this.generation === gen) {
        this.runState = 'idle';
        this.publish();
      }
    });
    return this.loop;
  }

  /** Finish the current task, then do not start another. */
  pause(): void {
    if (!this.loop) return;
    this.pauseRequested = true;
    this.runState = 'paused';
    this.publish();
  }

  /** Abort the current task and do not start another. */
  stop(): void {
    this.stopped = true;
    this.pauseRequested = false;
    if (this.abortCause !== 'gate') this.abortCause = 'stop';
    this.inflight?.abort();
    if (this.runState !== 'idle') {
      this.runState = 'paused';
      this.publish();
    }
  }

  private async runLoop(gen: number): Promise<void> {
    while (!this.stopped && !this.pauseRequested && this.generation === gen) {
      const next = this.tasks.find((task) => task.status === 'pending');
      if (!next) break;
      await this.runTask(next, gen);
    }
  }

  private async runTask(task: CascadeTask, gen: number): Promise<void> {
    if (this.generation !== gen) return;
    this.abortCause = null;
    this.gateReason = null;
    const started = new Date().toISOString();
    task.status = 'running';
    task.startedAt = started;
    delete task.reason;
    task.updatedAt = started;
    this.save();
    this.publish();

    const ctrl = new AbortController();
    this.inflight = ctrl;
    const wall = setTimeout(() => {
      if (this.abortCause == null) this.abortCause = 'wall';
      ctrl.abort();
    }, this.maxWallMs);

    let outcome: CascadeAgentOutcome;
    try {
      outcome = await this.executeTask(task, ctrl.signal);
      if (this.generation !== gen) return;
      outcome = this.applyAbort(outcome, ctrl.signal);
    } catch (err) {
      if (this.generation !== gen) return;
      const message = err instanceof Error ? err.message : String(err);
      outcome = {
        status: this.abortCause === 'stop' ? 'blocked' : 'failed',
        reason: this.abortCause === 'stop' ? 'Stopped by owner' : message,
        steps: [],
      };
      if (this.abortCause === 'wall') outcome = { status: 'failed', reason: this.wallReason(), steps: [] };
      if (this.gateReason) outcome = { status: 'blocked', reason: this.gateReason, steps: [] };
    } finally {
      clearTimeout(wall);
      if (this.inflight === ctrl) this.inflight = null;
    }

    if (this.generation !== gen) return;
    const finished = new Date().toISOString();
    task.status = outcome.status;
    task.updatedAt = finished;
    task.finishedAt = finished;
    if (outcome.reason) task.reason = clip(outcome.reason, MAX_REASON);
    else delete task.reason;
    try {
      task.receipt = this.writeReceipt(task, outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task.reason = clip(`${task.reason ? `${task.reason} ` : ''}Receipt was not written: ${message}`, MAX_REASON);
    }
    this.save();
    this.publish();
    this.emit('finish', cloneTask(task), outcome);
  }

  private applyAbort(outcome: CascadeAgentOutcome, signal: AbortSignal): CascadeAgentOutcome {
    if (this.gateReason) return { ...outcome, status: 'blocked', reason: this.gateReason };
    if (this.abortCause === 'wall') return { ...outcome, status: 'failed', reason: this.wallReason() };
    if (this.abortCause === 'stop' || (signal.aborted && this.stopped)) {
      return { ...outcome, status: 'blocked', reason: 'Stopped by owner' };
    }
    return outcome;
  }

  private wallReason(): string {
    return `Wall time exceeded (${this.maxWallMs}ms).`;
  }

  private async executeTask(task: CascadeTask, signal: AbortSignal): Promise<CascadeAgentOutcome> {
    const ran = this.executeOverride
      ? await this.executeOverride(task, signal)
      : await this.runWithAgent(task, signal);
    if (ran.status !== 'done') return ran;
    if (!task.acceptance) return ran;
    return this.runAcceptance(task, ran, signal);
  }

  private async runWithAgent(task: CascadeTask, signal: AbortSignal): Promise<CascadeAgentOutcome> {
    const cfg = this.llmConfig();
    if (cfg.allowPaidApis && process.env.JEWBOT_ALLOW_PAID !== '1') {
      return {
        status: 'failed',
        reason: 'Paid providers stay disabled unless JEWBOT_ALLOW_PAID=1.',
        steps: [],
      };
    }
    try {
      assertOllamaAllowed(cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failed', reason: message, steps: [] };
    }

    const agent = new AgentLoop({
      files: this.files,
      terminal: this.terminal,
      ssh: this.ssh,
      context: this.context,
      llm: cfg,
      maxSteps: this.maxSteps,
      confirmDestructive: async (req) => {
        this.noteGate(
          `Needs owner confirmation before a destructive command can run (${req.category}). ${req.reason} Command: ${clip(req.command, 300)}`,
        );
        return false;
      },
      confirmEdit: async (req) => {
        const kind = req.secret ? 'secret file edit' : 'file edit';
        this.noteGate(`Needs owner Accept before a ${kind} of ${req.path} can be written.`);
        return false;
      },
      confirmSecret: async (req) => {
        this.noteGate(`Needs owner confirmation before reading secret path ${req.path}.`);
        return false;
      },
      confirmHostKey: async (req) => {
        const changed = req.mismatch ? 'Host key changed. ' : '';
        this.noteGate(
          `${changed}Needs owner confirmation of SSH host key for ${req.name} (${req.host}:${req.port}) fingerprint ${req.fingerprint}.`,
        );
        return false;
      },
      promptSshSecret: async (req) => {
        this.noteGate(`Needs the owner to enter the SSH ${req.kind} for ${req.username}@${req.host}. Cascade does not invent one.`);
        return null;
      },
    });

    const result = await agent.run(task.prompt, signal);
    return this.classify(result, signal);
  }

  private classify(result: AgentRunResult, signal: AbortSignal): CascadeAgentOutcome {
    const steps = result.steps.map(summarizeStep);
    if (this.gateReason) return { status: 'blocked', reason: this.gateReason, steps };
    const observed = gateFromSteps(result.steps);
    if (observed) return { status: 'blocked', reason: observed, steps };
    if (result.steps.some((step) => step.tool?.name === 'ask_owner')) {
      return { status: 'blocked', reason: result.blockReason || 'Owner input required', steps };
    }
    if (this.abortCause === 'wall') return { status: 'failed', reason: this.wallReason(), steps };
    if (this.abortCause === 'stop' || (signal.aborted && this.stopped)) {
      return { status: 'blocked', reason: 'Stopped by owner', steps };
    }
    if (result.status === 'done') return { status: 'done', finalText: result.finalText, steps };
    return { status: 'failed', reason: result.blockReason || 'Agent did not finish', steps };
  }

  private noteGate(reason: string): void {
    if (!this.gateReason) this.gateReason = clip(reason, MAX_REASON);
    this.abortCause = 'gate';
    this.inflight?.abort();
  }

  private async runAcceptance(
    task: CascadeTask,
    ran: CascadeAgentOutcome,
    signal: AbortSignal,
  ): Promise<CascadeAgentOutcome> {
    const command = task.acceptance || '';
    const prepared = this.terminal.prepare(command);
    if (!prepared.ok && prepared.needsConfirmation) {
      return {
        ...ran,
        status: 'blocked',
        reason: `Acceptance check needs owner confirmation before it can run. ${prepared.reason || ''} Command: ${clip(command, 300)}`.trim(),
      };
    }
    if (!prepared.ok) {
      return { ...ran, status: 'failed', reason: prepared.reason || 'Acceptance check was rejected' };
    }
    if (signal.aborted) return this.applyAbort(ran, signal);

    let result: TerminalResult;
    try {
      result = await this.terminal.run(command, {
        cwd: this.projectRoot,
        projectRoot: this.projectRoot,
        signal,
        timeoutMs: Math.min(30_000, this.maxWallMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...ran, status: 'failed', reason: `Acceptance check failed to start: ${message}` };
    }
    const acceptance: CascadeAcceptanceSummary = {
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      killed: result.killed,
    };
    if (signal.aborted && (this.abortCause === 'stop' || this.stopped)) {
      return { ...ran, status: 'blocked', reason: 'Stopped by owner', acceptance };
    }
    if (result.exitCode === 0 && !result.timedOut && !result.killed) {
      return { ...ran, status: 'done', acceptance };
    }
    const detail = result.timedOut ? 'timed out' : result.killed ? 'killed' : `exit ${result.exitCode === null ? 'null' : result.exitCode}`;
    return { ...ran, status: 'failed', reason: `Acceptance check failed (${detail}).`, acceptance };
  }

  private llmConfig(): OllamaConfig {
    if (this.llm) return this.llm;
    return defaultOllamaConfig();
  }

  private writeReceipt(task: CascadeTask, outcome: CascadeAgentOutcome): string {
    const dir = path.join(this.storeRoot, '.jewbot', 'receipts');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = `${task.id}.md`;
    const abs = path.join(dir, name);
    assertInside(this.storeRoot, abs);
    const body = redactSecrets(renderReceipt(task, outcome));
    fs.writeFileSync(abs, body, { encoding: 'utf8', mode: 0o600 });
    return `.jewbot/receipts/${name}`;
  }

  private find(id: string): CascadeTask | undefined {
    if (!ID_RE.test(id)) return undefined;
    return this.tasks.find((task) => task.id === id);
  }

  private queuePath(): string {
    const file = path.join(this.storeRoot, '.jewbot', 'cascade.json');
    assertInside(this.storeRoot, file);
    return file;
  }

  private load(): void {
    this.tasks = [];
    this.loadError = null;
    const file = this.queuePath();
    if (!fs.existsSync(file)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.loadError = 'Cascade queue file is not valid JSON. It was left untouched.';
      return;
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== QUEUE_VERSION) {
      this.loadError = 'Cascade queue file version is not supported. It was left untouched.';
      return;
    }
    const raw = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(raw)) {
      this.loadError = 'Cascade queue file has no tasks array. It was left untouched.';
      return;
    }
    const hadRunning = raw.some((row) => !!row && typeof row === 'object' && (row as { status?: unknown }).status === 'running');
    this.tasks = raw.map(parseStoredTask).filter((task): task is CascadeTask => task !== null);
    if (hadRunning) this.save();
  }

  private save(): void {
    if (this.loadError) return;
    const file = this.queuePath();
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify({ version: QUEUE_VERSION, tasks: this.tasks }, null, 2) + '\n';
    const tmp = path.join(dir, `.cascade.${process.pid}.tmp`);
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  private publish(): void {
    if (this.loop) {
      if (this.pauseRequested || this.stopped) this.runState = 'paused';
      else this.runState = 'running';
    }
    this.emit('update', this.snapshot());
  }
}

export function renderReceipt(task: CascadeTask, outcome: CascadeAgentOutcome): string {
  const lines: string[] = [
    `# Cascade receipt: ${task.title}`,
    '',
    `- id: ${task.id}`,
    `- status: ${task.status}`,
    `- started: ${task.startedAt || ''}`,
    `- finished: ${task.finishedAt || ''}`,
  ];
  if (task.reason) lines.push(`- reason: ${task.reason}`);
  lines.push('', '## Prompt', '', fence(task.prompt.trim() || '(empty)'), '', '## What ran', '');
  if (!outcome.steps.length) {
    lines.push('No agent steps were recorded.');
  } else {
    for (const step of outcome.steps) {
      const tool = step.tool ? ` \`${step.tool}\`` : '';
      lines.push(`### Step ${step.n}${tool}`);
      if (step.args && Object.keys(step.args).length) {
        lines.push('', 'Args:', '', fence(clip(JSON.stringify(step.args, null, 2), 800)));
      }
      if (step.thought) lines.push('', 'Thought:', '', fence(clip(step.thought, RECEIPT_OBS_CHARS)));
      if (step.observation) lines.push('', 'Observation:', '', fence(clip(step.observation, RECEIPT_OBS_CHARS)));
      lines.push('');
    }
  }
  lines.push('## Acceptance', '');
  if (!task.acceptance) {
    lines.push('No acceptance command.');
  } else if (!outcome.acceptance) {
    lines.push(`Command: \`${task.acceptance}\``, '', 'The command was not run.');
  } else {
    const acc = outcome.acceptance;
    lines.push(
      `Command: \`${acc.command}\``,
      '',
      `- exit: ${acc.exitCode === null ? 'null' : String(acc.exitCode)}`,
      `- timed out: ${acc.timedOut}`,
      `- killed: ${acc.killed}`,
      '',
      'Stdout:',
      '',
      fence(clip(acc.stdout.trim() || '(empty)', RECEIPT_OUT_CHARS)),
      '',
      'Stderr:',
      '',
      fence(clip(acc.stderr.trim() || '(empty)', RECEIPT_OUT_CHARS)),
    );
  }
  lines.push('', '## Result', '');
  if (task.status === 'done') {
    lines.push(outcome.finalText ? `Done. ${outcome.finalText}` : 'Done. The next pending task can start.');
  } else if (task.status === 'blocked') {
    lines.push(
      'Blocked. Jewbot did not approve this step. The runner moved on to the next pending task.',
      task.reason || 'A human grant is required.',
    );
  } else {
    lines.push('Failed. The runner moved on to the next pending task.', task.reason || 'The task did not finish.');
  }
  lines.push('');
  return lines.join('\n');
}

function summarizeStep(step: AgentStep): CascadeStepSummary {
  const summary: CascadeStepSummary = { n: step.n };
  if (step.tool) {
    summary.tool = step.tool.name;
    summary.args = step.tool.args;
  }
  if (step.observation) summary.observation = step.observation;
  if (step.thought) summary.thought = step.thought;
  return summary;
}

const GATED_TOOLS = new Set([
  'run_terminal',
  'ssh_exec',
  'ssh_connect',
  'write_file',
  'apply_edit',
  'propose_edit',
  'read_file',
  'ask_owner',
]);

function gateFromSteps(steps: AgentStep[]): string | null {
  for (const step of steps) {
    if (!step.tool || !GATED_TOOLS.has(step.tool.name)) continue;
    const line = (step.observation || '').split('\n')[0]?.trim() || '';
    if (/^(BLOCKED|REJECTED|REFUSED):/.test(line)) return clip(line, MAX_REASON);
  }
  return null;
}

function parseStoredTask(raw: unknown): CascadeTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) return null;
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > MAX_TITLE) return null;
  if (typeof row.prompt !== 'string' || !row.prompt.trim() || row.prompt.length > MAX_PROMPT) return null;
  if (typeof row.status !== 'string' || !STATUSES.includes(row.status as CascadeTaskStatus)) return null;
  if (typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string') return null;
  const task: CascadeTask = {
    id: row.id,
    title: row.title.trim(),
    prompt: row.prompt,
    status: row.status === 'running' ? 'pending' : (row.status as CascadeTaskStatus),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (typeof row.acceptance === 'string' && row.acceptance.trim() && row.acceptance.length <= MAX_ACCEPTANCE) {
    task.acceptance = row.acceptance.trim();
  }
  if (typeof row.reason === 'string' && row.reason.trim()) task.reason = clip(row.reason, MAX_REASON);
  const receipt = `.jewbot/receipts/${task.id}.md`;
  if (row.receipt === receipt) task.receipt = receipt;
  if (typeof row.startedAt === 'string') task.startedAt = row.startedAt;
  if (typeof row.finishedAt === 'string') task.finishedAt = row.finishedAt;
  if (task.status === 'pending') {
    delete task.startedAt;
    delete task.finishedAt;
  }
  return task;
}

function newTaskId(): string {
  return `task_${randomUUID().replace(/-/g, '')}`;
}

function cloneTask(task: CascadeTask): CascadeTask {
  return JSON.parse(JSON.stringify(task)) as CascadeTask;
}

function cleanLine(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Cascade ${label} is required.`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`Cascade ${label} is required.`);
  if (text.length > max) throw new Error(`Cascade ${label} is too long.`);
  return text;
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Cascade ${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`Cascade ${label} is required.`);
  if (text.length > max) throw new Error(`Cascade ${label} is too long.`);
  return text;
}

function cleanAcceptance(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error('Cascade acceptance command is invalid.');
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > MAX_ACCEPTANCE) throw new Error('Cascade acceptance command is too long.');
  return text;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function fence(text: string): string {
  return '```\n' + text.replace(/```/g, '` ` `') + '\n```';
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function assertInside(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Cascade path escapes the project root.');
  }
}
