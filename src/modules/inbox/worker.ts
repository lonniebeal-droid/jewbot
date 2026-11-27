/**
 * Action inbox compatible with ju-command-center runtime/dell/worker.py.
 *
 * Files: inbox/<task_id>.json, work/<task_id>.claimed.json, receipts/<task_id>.json.
 * Claim is an atomic rename. _claim stores attempts, claimed_at, and claimed_by.
 * A task that needs a person is BLOCKED. Nothing here auto-approves a gate.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AgentLoop } from '../agent';
import { ContextIndexer } from '../context';
import { FileWorkspace } from '../files';
import { isRoutableFreeHost } from '../llm/ollama';
import { defaultSshManager } from '../ssh';
import { assertLocalSpendOnly } from '../safety';
import { defaultTerminal } from '../terminal';

export const STALE_CLAIM_SECONDS = 600;
export const MAX_ATTEMPTS = 3;

export type OwnerStatus = 'VERIFIED' | 'PARTIAL' | 'BLOCKED';
export type JuStatus = 'ok' | 'failed' | 'rejected';

export interface InboxTask {
  task_id: string;
  type: string;
  payload: Record<string, unknown>;
  _claim?: { attempts?: number; claimed_at?: string; claimed_by?: string };
}

export interface InboxReceipt {
  receipt_id: string;
  task_id: string;
  type: string | null;
  datetime: string;
  project: string;
  worker: string;
  node: string;
  worker_version: string;
  claimed_at: string | null;
  finished_at: string;
  attempts: number;
  status: OwnerStatus;
  ju_status: JuStatus;
  changes: string;
  verification: { passed: boolean; detail: string };
  blocker: string | null;
  next_action: string | null;
  spend: '$0';
  execution: Record<string, unknown>;
  error?: string;
}

export interface InboxLayout {
  root: string;
  inbox: string;
  work: string;
  receipts: string;
  duplicates: string;
  quarantine: string;
}

export function inboxLayout(root: string): InboxLayout {
  const abs = path.resolve(root);
  return {
    root: abs,
    inbox: path.join(abs, 'inbox'),
    work: path.join(abs, 'work'),
    receipts: path.join(abs, 'receipts'),
    duplicates: path.join(abs, 'work', 'duplicates'),
    quarantine: path.join(abs, 'work', 'quarantine'),
  };
}

export function assertInboxUrl(raw: string): string {
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Inbox keeps the spend gate closed.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Inbox URL is not valid: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Inbox URL must be http or https.');
  if (!isRoutableFreeHost(url.origin)) throw new Error(`Refusing inbox host ${url.origin}`);
  return url.toString().replace(/\/$/, '');
}

function utcnow(): string {
  return new Date().toISOString();
}

function ensure(layout: InboxLayout): void {
  for (const dir of [layout.inbox, layout.work, layout.receipts, layout.duplicates, layout.quarantine]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadTask(file: string): { task: InboxTask | null; error: string | null; hint: string } {
  const hint = path.basename(file, '.json').replace(/\.claimed$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { task: null, error: `invalid_json: ${err instanceof Error ? err.message : String(err)}`, hint };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { task: null, error: 'invalid_json: top-level must be an object', hint };
  }
  const record = parsed as Record<string, unknown>;
  const task_id = typeof record.task_id === 'string' && record.task_id ? record.task_id : hint;
  if (typeof record.type !== 'string') return { task: null, error: "invalid_schema: missing string 'type'", hint: task_id };
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    return { task: null, error: "invalid_schema: missing object 'payload'", hint: task_id };
  }
  const claim = record._claim && typeof record._claim === 'object' ? (record._claim as InboxTask['_claim']) : undefined;
  return { task: { task_id, type: record.type, payload: record.payload as Record<string, unknown>, _claim: claim }, error: null, hint: task_id };
}

function claim(layout: InboxLayout, file: string, task: InboxTask, worker: string): string {
  const info = { ...(task._claim || {}) };
  info.attempts = Number(info.attempts || 0) + 1;
  info.claimed_at = utcnow();
  info.claimed_by = worker;
  task._claim = info;
  const body = `${JSON.stringify(task, null, 2)}\n`;
  fs.writeFileSync(file, body);
  const dest = path.join(layout.work, `${task.task_id}.claimed.json`);
  fs.renameSync(file, dest);
  return dest;
}

export function reclaimStale(layout: InboxLayout, now = Date.now()): string[] {
  ensure(layout);
  const notes: string[] = [];
  for (const file of fs.readdirSync(layout.work).filter((name) => name.endsWith('.claimed.json'))) {
    const abs = path.join(layout.work, file);
    const age = (now - fs.statSync(abs).mtimeMs) / 1000;
    if (age < STALE_CLAIM_SECONDS) continue;
    const { task, error, hint } = loadTask(abs);
    if (error || !task) {
      fs.renameSync(abs, path.join(layout.quarantine, file));
      notes.push(`quarantine ${hint}`);
      continue;
    }
    const attempts = Number(task._claim?.attempts || 1);
    if (attempts >= MAX_ATTEMPTS) {
      writeReceipt(layout, task, {
        project: layout.root,
        worker: task._claim?.claimed_by || 'jewbot',
        status: 'BLOCKED',
        ju_status: 'failed',
        changes: '',
        verification: `max_attempts_exceeded (${attempts})`,
        blocker: `max_attempts_exceeded (${attempts})`,
        next_action: 'Inspect the task and submit a new task_id.',
        passed: false,
      });
      fs.unlinkSync(abs);
      notes.push(`failed ${task.task_id}`);
    } else {
      fs.renameSync(abs, path.join(layout.inbox, `${task.task_id}.json`));
      notes.push(`inbox ${task.task_id}`);
    }
  }
  return notes;
}

function needsPerson(task: InboxTask): boolean {
  return task.payload.needs_owner === true || task.type === 'ask.owner';
}

export interface ReceiptInput {
  project: string;
  worker: string;
  status: OwnerStatus;
  ju_status: JuStatus;
  changes: string;
  verification: string;
  blocker: string | null;
  next_action: string | null;
  passed: boolean;
  execution?: Record<string, unknown>;
  error?: string;
}

export function writeReceipt(layout: InboxLayout, task: InboxTask, input: ReceiptInput): InboxReceipt {
  ensure(layout);
  const receipt: InboxReceipt = {
    receipt_id: `rcpt_${randomUUID()}`,
    task_id: task.task_id,
    type: task.type,
    datetime: utcnow(),
    project: input.project,
    worker: input.worker,
    node: input.worker,
    worker_version: '0.6.0',
    claimed_at: task._claim?.claimed_at || null,
    finished_at: utcnow(),
    attempts: Number(task._claim?.attempts || 1),
    status: input.status,
    ju_status: input.ju_status,
    changes: input.changes,
    verification: { passed: input.passed, detail: input.verification },
    blocker: input.blocker,
    next_action: input.next_action,
    spend: '$0',
    execution: input.execution || {},
  };
  if (input.error) receipt.error = input.error;
  fs.writeFileSync(path.join(layout.receipts, `${task.task_id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export type InboxRunner = (task: InboxTask, project: string) => Promise<ReceiptInput>;

export function agentRunner(project: string): InboxRunner {
  return async (task) => {
    const goal = typeof task.payload.goal === 'string' ? task.payload.goal : JSON.stringify(task.payload);
    const files = new FileWorkspace(project);
    const agent = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context: new ContextIndexer(project),
      confirmEdit: async () => false,
      confirmDestructive: async () => false,
      confirmSecret: async () => false,
      confirmHostKey: async () => false,
      confirmReleaseDone: async () => false,
    });
    const result = await agent.run(goal);
    const observations = result.steps.map((step) => step.observation || '').join('\n');
    const blocked = /BLOCKED:|REJECTED:|REFUSED:/.test(observations) || result.status === 'blocked';
    return {
      project,
      worker: 'jewbot',
      status: blocked ? 'BLOCKED' : result.status === 'done' ? 'VERIFIED' : 'PARTIAL',
      ju_status: blocked ? 'rejected' : result.status === 'done' ? 'ok' : 'failed',
      changes: result.steps
        .filter((step) => step.tool)
        .map((step) => `${step.tool?.name} ${JSON.stringify(step.tool?.args)}`)
        .join('\n'),
      verification: result.finalText || result.blockReason || observations.slice(0, 500),
      blocker: blocked ? result.blockReason || 'A confirm gate refused the step.' : null,
      next_action: blocked ? 'A person must Accept or confirm the blocked step.' : null,
      passed: !blocked && result.status === 'done',
      execution: { steps: result.steps.length },
    };
  };
}

/** Claim and finish one inbox task. Returns null when the inbox is empty. */
export async function pollInbox(options: {
  root: string;
  project: string;
  worker?: string;
  run?: InboxRunner;
}): Promise<InboxReceipt | null> {
  const layout = inboxLayout(options.root);
  ensure(layout);
  reclaimStale(layout);
  const files = fs.readdirSync(layout.inbox).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) return null;
  const file = path.join(layout.inbox, files[0]);
  const { task, error, hint } = loadTask(file);
  if (error || !task) {
    fs.renameSync(file, path.join(layout.quarantine, path.basename(file)));
    return writeReceipt(layout, { task_id: hint, type: '', payload: {} }, {
      project: options.project,
      worker: options.worker || 'jewbot',
      status: 'BLOCKED',
      ju_status: 'failed',
      changes: '',
      verification: error || 'invalid task',
      blocker: error,
      next_action: 'Fix the task JSON and submit a new id.',
      passed: false,
      error: error || undefined,
    });
  }
  if (fs.existsSync(path.join(layout.receipts, `${task.task_id}.json`))) {
    fs.renameSync(file, path.join(layout.duplicates, `${task.task_id}.json`));
    return null;
  }
  const worker = options.worker || 'jewbot';
  claim(layout, file, task, worker);
  const claimed = path.join(layout.work, `${task.task_id}.claimed.json`);
  let input: ReceiptInput;
  if (needsPerson(task)) {
    input = {
      project: options.project,
      worker,
      status: 'BLOCKED',
      ju_status: 'rejected',
      changes: '',
      verification: 'needs a person',
      blocker: 'needs_owner',
      next_action: 'A person must handle this task. It was not auto-approved.',
      passed: false,
    };
  } else {
    const run = options.run || agentRunner(options.project);
    input = await run(task, options.project);
    input.worker = worker;
    input.project = options.project;
  }
  const receipt = writeReceipt(layout, task, input);
  fs.unlinkSync(claimed);
  return receipt;
}

export async function pollInboxHttp(options: {
  url: string;
  project: string;
  worker?: string;
  run?: InboxRunner;
  fetchImpl?: typeof fetch;
}): Promise<InboxReceipt | null> {
  const base = assertInboxUrl(options.url);
  const fetchImpl = options.fetchImpl || fetch;
  const listed = await fetchImpl(`${base}/inbox`);
  if (!listed.ok) throw new Error(`Inbox list failed: ${listed.status}`);
  const body = (await listed.json()) as { tasks?: InboxTask[] } | InboxTask[];
  const tasks = Array.isArray(body) ? body : body.tasks || [];
  const task = tasks[0];
  if (!task) return null;
  const claimRes = await fetchImpl(`${base}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: task.task_id }),
  });
  if (claimRes.status === 409) return null;
  if (!claimRes.ok) throw new Error(`Inbox claim failed: ${claimRes.status}`);
  const claimed = (await claimRes.json()) as InboxTask;
  const worker = options.worker || 'jewbot';
  const input = needsPerson(claimed)
    ? {
        project: options.project,
        worker,
        status: 'BLOCKED' as const,
        ju_status: 'rejected' as const,
        changes: '',
        verification: 'needs a person',
        blocker: 'needs_owner',
        next_action: 'A person must handle this task. It was not auto-approved.',
        passed: false,
      }
    : await (options.run || agentRunner(options.project))(claimed, options.project);
  const layout = inboxLayout(options.project);
  const receipt = writeReceipt(layout, claimed, { ...input, worker, project: options.project });
  await fetchImpl(`${base}/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt),
  });
  return receipt;
}
