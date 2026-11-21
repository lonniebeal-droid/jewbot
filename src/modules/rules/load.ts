/**
 * Project rules for the agent system prompt.
 * .jewbot/rules.md plus a rules.md in the active folder and its parents.
 * The settings toggle lives in ~/.jewbot/settings.json and defaults to on.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MAX_CHARS = 16_000;

export function settingsPath(): string {
  const override = process.env.JEWBOT_SETTINGS_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.jewbot', 'settings.json');
}

function readSettings(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Refusing to read a symlinked settings file.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function rulesEnabled(file = settingsPath()): boolean {
  try {
    const raw = readSettings(file).rules;
    if (typeof raw === 'boolean') return raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { enabled?: unknown }).enabled === 'boolean') {
      return (raw as { enabled: boolean }).enabled;
    }
    return true;
  } catch {
    return true;
  }
}

export function setRulesEnabled(enabled: boolean, file = settingsPath()): void {
  const current = fs.existsSync(file) ? readSettings(file) : {};
  current.rules = enabled;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readRuleFile(root: string, file: string, label: string): string {
  const abs = path.resolve(file);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return '';
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return '';
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return '';
  const text = fs.readFileSync(abs, 'utf8').slice(0, MAX_CHARS).trim();
  return text ? `# ${label}\n${text}` : '';
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.jewbot']);

function collectRules(root: string, dir: string, depth: number, parts: string[]): void {
  if (depth > 6 || parts.length >= 8) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectRules(root, abs, depth + 1, parts);
      continue;
    }
    if (!entry.isFile() || entry.name !== 'rules.md') continue;
    const text = readRuleFile(root, abs, path.relative(root, abs));
    if (text) parts.push(text);
    if (parts.length >= 8) return;
  }
}

/** Rules for one project. `.jewbot/rules.md` plus every in-project `rules.md`, skipping vendor dirs and symlinks. */
export function loadRules(projectRoot: string, _activeDir = '.'): string {
  if (!rulesEnabled()) return '';
  const root = path.resolve(projectRoot);
  const parts: string[] = [];
  const rootRules = readRuleFile(root, path.join(root, '.jewbot', 'rules.md'), '.jewbot/rules.md');
  if (rootRules) parts.push(rootRules);
  collectRules(root, root, 0, parts);
  return parts.join('\n\n');
}

export function systemWithRules(system: string, projectRoot: string, activeDir = '.'): string {
  const rules = loadRules(projectRoot, activeDir);
  if (!rules) return system;
  return `${system}\n\nProject rules:\n${rules}`;
}
