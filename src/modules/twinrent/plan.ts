/**
 * Local TwinRent plan file.
 *
 * Reads and writes `<root>/.jewbot/twinrent-plan.json`. Only known step ids
 * and statuses are kept. Titles always come from the bundle, so a hand-edited
 * file cannot turn this module into a credential store. Publish cannot be
 * marked done. Nothing here opens a socket.
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertInsideProject } from '../safety';
import {
  bundledPlan,
  cloneStep,
  isTwinrentStepId,
  PLAN_FILE_VERSION,
  STEP_STATUSES,
  type StepStatus,
  type TwinrentStep,
  type TwinrentStepId,
} from './checklist';

const FILE_NAME = 'twinrent-plan.json';
const MAX_BYTES = 64 * 1024;

export interface PlanSource {
  source: 'file' | 'bundled';
  path: string;
  steps: TwinrentStep[];
}

export interface MarkStepResult {
  source: 'file';
  path: string;
  step: TwinrentStep;
  /** Always false. This module never posts a listing. */
  published: false;
}

export function resolveTwinrentRoot(explicit?: string): string {
  const raw = (explicit !== undefined ? explicit : process.env.JEWBOT_PROJECT_ROOT || process.cwd()).trim();
  if (!raw) throw new Error('TwinRent root is empty.');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs)) throw new Error(`TwinRent root is not a directory: ${abs}`);
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`TwinRent root is not a real directory: ${abs}`);
  }
  return fs.realpathSync(abs);
}

export function planFilePath(root?: string): string {
  const project = resolveTwinrentRoot(root);
  return containedPlanPath(project);
}

export function listSteps(root?: string): PlanSource {
  const project = resolveTwinrentRoot(root);
  const file = containedPlanPath(project);
  if (!fs.existsSync(file)) {
    return { source: 'bundled', path: file, steps: bundledPlan().steps };
  }
  return { source: 'file', path: file, steps: readPlan(file).steps.map(cloneStep) };
}

export function nextFreeStep(root?: string): { source: PlanSource['source']; path: string; step: TwinrentStep | null } {
  const listed = listSteps(root);
  const step = listed.steps.find((row) => row.status === 'open' && row.id !== 'publish' && !row.blocker) ?? null;
  return { source: listed.source, path: listed.path, step: step ? cloneStep(step) : null };
}

/**
 * Set one status. `publish` cannot become done. Unknown ids and a corrupt
 * file throw before any write.
 */
export function markStep(id: string, status: string, root?: string): MarkStepResult {
  if (!isTwinrentStepId(id)) throw new Error(`Unknown TwinRent step: ${id}`);
  if (!(STEP_STATUSES as readonly string[]).includes(status)) {
    throw new Error('TwinRent status must be open, blocked, or done.');
  }
  const nextStatus = status as StepStatus;
  if (id === 'publish') {
    throw new Error('TwinRent does not publish. The publish step stays blocked.');
  }
  const project = resolveTwinrentRoot(root);
  const file = containedPlanPath(project);
  const plan = fs.existsSync(file) ? readPlan(file) : bundledPlan();
  const row = plan.steps.find((step) => step.id === id);
  if (!row) throw new Error(`Unknown TwinRent step: ${id}`);
  row.status = nextStatus;
  writePlan(project, file, plan);
  return { source: 'file', path: file, step: cloneStep(row), published: false };
}

function containedPlanPath(project: string): string {
  const jewbot = path.join(project, '.jewbot');
  const file = path.join(jewbot, FILE_NAME);
  const decision = assertInsideProject(project, file);
  if (!decision.ok) throw new Error(decision.reason);
  if (fs.existsSync(jewbot) && fs.lstatSync(jewbot).isSymbolicLink()) {
    throw new Error('Refusing to follow a symlinked .jewbot directory.');
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Refusing to follow a symlinked TwinRent plan.');
  }
  return file;
}

function readPlan(file: string): { version: number; steps: TwinrentStep[] } {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('TwinRent plan is not a regular file. It was left untouched.');
  if (stat.size > MAX_BYTES) throw new Error('TwinRent plan is too large. It was left untouched.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('TwinRent plan is not valid JSON. It was left untouched.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TwinRent plan is not an object. It was left untouched.');
  }
  const body = parsed as { version?: unknown; steps?: unknown };
  if (body.version !== PLAN_FILE_VERSION) {
    throw new Error('TwinRent plan version is not supported. It was left untouched.');
  }
  if (!Array.isArray(body.steps)) throw new Error('TwinRent plan has no steps array. It was left untouched.');
  const bundled = bundledPlan();
  const statusById = new Map<TwinrentStepId, StepStatus>();
  for (const entry of body.steps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('TwinRent plan step is not an object. It was left untouched.');
    }
    const row = entry as { id?: unknown; status?: unknown };
    if (typeof row.id !== 'string' || !isTwinrentStepId(row.id)) {
      throw new Error('TwinRent plan has an unknown step. It was left untouched.');
    }
    if (typeof row.status !== 'string' || !(STEP_STATUSES as readonly string[]).includes(row.status)) {
      throw new Error('TwinRent plan has a bad status. It was left untouched.');
    }
    if (row.id === 'publish' && row.status === 'done') {
      throw new Error('TwinRent plan marked publish done. It was left untouched.');
    }
    statusById.set(row.id, row.status as StepStatus);
  }
  return {
    version: PLAN_FILE_VERSION,
    steps: bundled.steps.map((step) => {
      const status = statusById.get(step.id) ?? step.status;
      return { ...cloneStep(step), status: step.id === 'publish' ? 'blocked' : status };
    }),
  };
}

function writePlan(project: string, file: string, plan: { version: number; steps: TwinrentStep[] }): void {
  const dir = path.join(project, '.jewbot');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Refusing to follow a symlinked .jewbot directory.');
  const payload = {
    version: PLAN_FILE_VERSION,
    steps: plan.steps.map((step) => ({ id: step.id, status: step.id === 'publish' ? 'blocked' : step.status })),
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const tmp = path.join(dir, `.${FILE_NAME}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
