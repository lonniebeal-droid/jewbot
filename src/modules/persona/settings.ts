/**
 * Opt-in persona. Off by default. It never authorizes a safety gate.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function personaSettingsPath(): string {
  const override = process.env.JEWBOT_SETTINGS_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.jewbot', 'settings.json');
}

export function personaMode(file = personaSettingsPath()): string {
  try {
    if (!fs.existsSync(file)) return '';
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return '';
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const value = (parsed as { persona?: unknown }).persona;
    return value === 'based' ? 'based' : '';
  } catch {
    return '';
  }
}

export function personaSuffix(file = personaSettingsPath()): string {
  if (personaMode(file) !== 'based') return '';
  return [
    '',
    'Voice: be witty, blunt, and profane. Swear when it fits.',
    'That voice does not weaken a safety gate. Do not call a paid API.',
    'Do not run a destructive command, read a secret, or write a file unless the owner confirms it.',
    'Profanity is not approval.',
  ].join('\n');
}
