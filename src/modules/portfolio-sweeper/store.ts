/**
 * Local portfolio gate file.
 *
 * Reads `<root>/.jewbot/portfolio-gates.json` when it exists. Otherwise the
 * bundled checklist is used and nothing is written. `markGate` changes one
 * status field in that file. It does not deploy, spawn a shell, or call a network.
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertInsideProject } from '../safety';
import {
  bundledGateFile,
  cloneGate,
  GATE_FILE_VERSION,
  GATE_STATUSES,
  type BlockerKind,
  type GateBlocker,
  type GateStatus,
  type PortfolioGate,
  type PortfolioGateFile,
} from './checklist';

const FILE_NAME = 'portfolio-gates.json';
const MAX_BYTES = 256 * 1024;
const MAX_GATES = 100;
const MAX_TITLE = 200;
const MAX_NOTE = 500;
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export interface GateSource {
  source: 'file' | 'bundled';
  path: string;
  gates: PortfolioGate[];
}

export interface MarkGateResult {
  source: 'file';
  path: string;
  gate: PortfolioGate;
  /** Always false. This tool never deploys. */
  deployed: false;
}

export function resolvePortfolioRoot(explicit?: string): string {
  const raw = (explicit !== undefined ? explicit : process.env.JEWBOT_PROJECT_ROOT || process.cwd()).trim();
  if (!raw) throw new Error('Portfolio root is empty.');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Portfolio root is not a directory: ${abs}`);
  }
  return fs.realpathSync(abs);
}

export function gateFilePath(root: string): string {
  return path.join(resolvePortfolioRoot(root), '.jewbot', FILE_NAME);
}

export function listGates(root?: string): GateSource {
  const project = resolvePortfolioRoot(root);
  const file = path.join(project, '.jewbot', FILE_NAME);
  assertContained(project, file);
  assertDirNotLinked(path.join(project, '.jewbot'));
  if (locateGateFile(file) === 'absent') {
    return { source: 'bundled', path: file, gates: bundledGateFile().gates };
  }
  return { source: 'file', path: file, gates: readGateFile(file).gates.map(cloneGate) };
}

export function nextFreeGate(root?: string): { source: GateSource['source']; path: string; gate: PortfolioGate | null } {
  const listed = listGates(root);
  const gate = listed.gates.find(isFreeGate) ?? null;
  return { source: listed.source, path: listed.path, gate: gate ? cloneGate(gate) : null };
}

/**
 * Write one status into the local gate file. Other fields stay as they were.
 * A missing file is created from the bundled checklist, then the status is set.
 */
export function markGate(id: string, status: string, root?: string): MarkGateResult {
  const gateId = requireId(id);
  const nextStatus = requireStatus(status);
  const project = resolvePortfolioRoot(root);
  const file = path.join(project, '.jewbot', FILE_NAME);
  assertContained(project, file);
  assertDirNotLinked(path.join(project, '.jewbot'));

  if (locateGateFile(file) === 'absent') {
    const created = bundledGateFile();
    const row = created.gates.find((gate) => gate.id === gateId);
    if (!row) throw new Error(`Unknown portfolio gate: ${gateId}`);
    row.status = nextStatus;
    writeGateFile(project, file, created);
    return { source: 'file', path: file, gate: cloneGate(row), deployed: false };
  }

  const rawText = readText(file);
  const parsed = parseJson(rawText);
  const normalized = normalizeFile(parsed);
  if (!normalized.gates.some((gate) => gate.id === gateId)) {
    throw new Error(`Unknown portfolio gate: ${gateId}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Portfolio gate file is not an object. It was left untouched.');
  }
  const body = parsed as Record<string, unknown>;
  const gates = body.gates;
  if (!Array.isArray(gates)) throw new Error('Portfolio gate file has no gates array. It was left untouched.');
  const row = gates.find((gate) => !!gate && typeof gate === 'object' && (gate as { id?: unknown }).id === gateId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Unknown portfolio gate: ${gateId}`);
  if (row.status !== nextStatus) {
    row.status = nextStatus;
    writeGateFile(project, file, body);
  }
  const updated = normalizeFile(body).gates.find((gate) => gate.id === gateId);
  if (!updated) throw new Error(`Unknown portfolio gate: ${gateId}`);
  return { source: 'file', path: file, gate: cloneGate(updated), deployed: false };
}

export function isOwnerOrHumanBlocker(gate: PortfolioGate): boolean {
  return gate.blocker?.kind === 'owner' || gate.blocker?.kind === 'human';
}

/** An open gate the sweeper can work without waiting on a person. */
export function isFreeGate(gate: PortfolioGate): boolean {
  return gate.status === 'open' && !isOwnerOrHumanBlocker(gate);
}

function requireId(id: string): string {
  const trimmed = id.trim();
  if (!ID_RE.test(trimmed)) throw new Error(`Invalid portfolio gate id: ${id}`);
  return trimmed;
}

function requireStatus(status: string): GateStatus {
  const trimmed = status.trim();
  if (!(GATE_STATUSES as readonly string[]).includes(trimmed)) {
    throw new Error('Portfolio gate status must be open, blocked, or done.');
  }
  return trimmed as GateStatus;
}

function readGateFile(file: string): PortfolioGateFile {
  return normalizeFile(parseJson(readText(file)));
}

function locateGateFile(file: string): 'absent' | 'file' {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return 'absent';
    throw err;
  }
  if (stat.isSymbolicLink()) throw new Error(`Path escapes project root: ${file}`);
  if (!stat.isFile()) throw new Error('Portfolio gate file is not a file. It was left untouched.');
  return 'file';
}

function assertDirNotLinked(dir: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink()) throw new Error(`Path escapes project root: ${dir}`);
}

function readText(file: string): string {
  if (locateGateFile(file) !== 'file') {
    throw new Error('Portfolio gate file is not a file. It was left untouched.');
  }
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) throw new Error('Portfolio gate file is too large. It was left untouched.');
  return fs.readFileSync(file, 'utf8');
}

function codeOf(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Portfolio gate file is not valid JSON. It was left untouched.');
  }
}

function normalizeFile(raw: unknown): PortfolioGateFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Portfolio gate file is not an object. It was left untouched.');
  }
  const body = raw as Record<string, unknown>;
  if (body.version !== GATE_FILE_VERSION) {
    throw new Error('Portfolio gate file version is not supported. It was left untouched.');
  }
  if (!Array.isArray(body.gates)) {
    throw new Error('Portfolio gate file has no gates array. It was left untouched.');
  }
  if (body.gates.length > MAX_GATES) {
    throw new Error('Portfolio gate file has too many gates. It was left untouched.');
  }
  const seen = new Set<string>();
  const gates = body.gates.map((row) => normalizeGate(row, seen));
  return { version: GATE_FILE_VERSION, gates };
}

function normalizeGate(row: unknown, seen: Set<string>): PortfolioGate {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Portfolio gate file has a gate that is not an object. It was left untouched.');
  }
  const gate = row as Record<string, unknown>;
  if (typeof gate.id !== 'string' || !ID_RE.test(gate.id)) {
    throw new Error('Portfolio gate file has an invalid id. It was left untouched.');
  }
  if (seen.has(gate.id)) throw new Error(`Portfolio gate file repeats id ${gate.id}. It was left untouched.`);
  seen.add(gate.id);
  if (typeof gate.title !== 'string' || !gate.title.trim() || gate.title.length > MAX_TITLE) {
    throw new Error(`Portfolio gate ${gate.id} needs a title. It was left untouched.`);
  }
  if (typeof gate.status !== 'string' || !(GATE_STATUSES as readonly string[]).includes(gate.status)) {
    throw new Error(`Portfolio gate ${gate.id} has a status that is not open, blocked, or done. It was left untouched.`);
  }
  return {
    id: gate.id,
    title: gate.title.trim(),
    status: gate.status as GateStatus,
    blocker: normalizeBlocker(gate.blocker, gate.id),
  };
}

function normalizeBlocker(value: unknown, id: string): GateBlocker | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return blockerFromString(value);
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Portfolio gate ${id} has a blocker that is not an object or string. It was left untouched.`);
  }
  const blocker = value as Record<string, unknown>;
  const kind = blocker.kind;
  if (kind === 'none') return null;
  if (kind !== 'owner' && kind !== 'human' && kind !== 'local') {
    throw new Error(`Portfolio gate ${id} has an unknown blocker kind. It was left untouched.`);
  }
  const note = blocker.note === undefined ? '' : blocker.note;
  if (typeof note !== 'string' || note.length > MAX_NOTE) {
    throw new Error(`Portfolio gate ${id} has a blocker note that is too long. It was left untouched.`);
  }
  return { kind, note: note.trim() };
}

function blockerFromString(raw: string): GateBlocker | null {
  const text = raw.trim();
  if (!text || /^none$/i.test(text)) return null;
  if (text.length > MAX_NOTE) throw new Error('Portfolio gate blocker note is too long. It was left untouched.');
  const prefixed = text.match(/^(owner|human|local)\b[:\s-]*(.*)$/i);
  if (prefixed) {
    const kind = prefixed[1].toLowerCase() as BlockerKind;
    return { kind, note: (prefixed[2] || '').trim() };
  }
  if (/\bowner\b/i.test(text)) return { kind: 'owner', note: text };
  if (/\bhuman\b/i.test(text)) return { kind: 'human', note: text };
  return { kind: 'local', note: text };
}

function writeGateFile(project: string, file: string, body: unknown): void {
  assertContained(project, file);
  const dir = path.dirname(file);
  assertDirNotLinked(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertContained(project, dir);
  assertDirNotLinked(dir);
  const tmp = path.join(dir, `.portfolio-gates.${process.pid}.${Date.now()}.tmp`);
  assertContained(project, tmp);
  const text = `${JSON.stringify(body, null, 2)}\n`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    assertContained(project, file);
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The temp file was not created.
    }
    throw err;
  }
}

function assertContained(root: string, target: string): void {
  const rootReal = fs.realpathSync(root);
  const resolved = path.resolve(target);
  const lexical = assertInsideProject(rootReal, resolved);
  if (!lexical.ok) throw new Error(lexical.reason);
  const existing = nearestExisting(resolved);
  const real = fs.realpathSync(existing);
  const landed = assertInsideProject(rootReal, real);
  if (!landed.ok) throw new Error(`Path escapes project root: ${target}`);
  if (existing === resolved && fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      const linkReal = fs.realpathSync(resolved);
      const linkCheck = assertInsideProject(rootReal, linkReal);
      if (!linkCheck.ok) throw new Error(`Path escapes project root: ${target}`);
    }
  }
}

function nearestExisting(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}
