/**
 * Per-feature model names in ~/.jewbot/settings.json.
 * Missing file means the built-in defaults. Other keys in the file are kept.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type FeatureName = 'chat' | 'autocomplete' | 'embeddings' | 'inlineEdit';

const FEATURES: FeatureName[] = ['chat', 'autocomplete', 'embeddings', 'inlineEdit'];

export function settingsPath(): string {
  const override = process.env.JEWBOT_SETTINGS_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.jewbot', 'settings.json');
}

export function loadSettings(file = settingsPath()): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Refusing to read a symlinked settings file.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function featureModel(feature: FeatureName, file = settingsPath()): string | undefined {
  try {
    const models = loadSettings(file).models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) return undefined;
    const value = (models as Record<string, unknown>)[feature];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function saveFeatureModels(next: Partial<Record<FeatureName, string>>, file = settingsPath()): Record<string, unknown> {
  const current = fs.existsSync(file) ? loadSettings(file) : {};
  const models =
    current.models && typeof current.models === 'object' && !Array.isArray(current.models)
      ? { ...(current.models as Record<string, unknown>) }
      : {};
  for (const key of FEATURES) {
    if (next[key] === undefined) continue;
    const value = String(next[key]).trim();
    if (value) models[key] = value;
    else delete models[key];
  }
  current.models = models;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return current;
}
