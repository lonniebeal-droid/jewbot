/**
 * Local fleet membership. SSH secrets stay in the hosts file.
 * This file names machines only. Passwords, passphrases, and key bytes are rejected.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isLocalOllamaHost, isPaidProviderHost, normalizeOllamaHost } from '../llm/ollama';
import { expandHome } from '../ssh/config';

export type FleetVia = 'local' | 'ssh';

export interface FleetFileEntry {
  name: string;
  via: FleetVia;
  /** Allowlist name. Present for ssh entries. Defaults to `name` when omitted in the file. */
  sshName?: string;
  /** Local Ollama base URL. Only legal for via=local, and only for a loopback host. */
  ollamaHost?: string;
}

export interface FleetFileLoad {
  hosts: FleetFileEntry[] | null;
  missing: boolean;
  error: string | null;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_FIELDS = [
  'password',
  'passphrase',
  'privateKey',
  'private_key',
  'key',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'credential',
  'credentials',
] as const;

export function defaultFleetPath(): string {
  const override = process.env.JEWBOT_FLEET?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.jewbot', 'fleet.json');
}

export function loadFleetFile(filePath: string): FleetFileLoad {
  if (!fs.existsSync(filePath)) return { hosts: null, missing: true, error: null };
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { hosts: null, missing: false, error: `Could not read fleet file: ${err instanceof Error ? err.message : 'unreadable'}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { hosts: null, missing: false, error: 'Fleet file is not valid JSON. Secrets were not logged.' };
  }
  try {
    return { hosts: parseFleetDocument(parsed, filePath), missing: false, error: null };
  } catch (err) {
    return { hosts: null, missing: false, error: err instanceof Error ? err.message : 'Invalid fleet file' };
  }
}

export function parseFleetDocument(parsed: unknown, sourceLabel: string): FleetFileEntry[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Fleet file ${sourceLabel} must be an object with a hosts array`);
  }
  const record = parsed as Record<string, unknown>;
  rejectForbidden(record, sourceLabel);
  const hosts = record.hosts;
  if (!Array.isArray(hosts)) throw new Error(`Fleet file ${sourceLabel} is missing a hosts array`);
  if (hosts.length > 100) throw new Error('Fleet file has too many entries');
  const seen = new Set<string>();
  return hosts.map((entry, index) => parseFleetEntry(entry, index, seen));
}

function parseFleetEntry(entry: unknown, index: number, seen: Set<string>): FleetFileEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Fleet host at index ${index} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const nameHint = typeof record.name === 'string' ? record.name : `#${index}`;
  rejectForbidden(record, nameHint);
  const name = requiredString(record.name, 'name');
  if (!NAME_RE.test(name)) throw new Error(`Fleet host "${name}" must use letters, digits, dot, underscore, or dash`);
  if (seen.has(name)) throw new Error(`Duplicate fleet host name: ${name}`);
  seen.add(name);
  const via = record.via;
  if (via !== 'local' && via !== 'ssh') throw new Error(`Fleet host "${name}" via must be "local" or "ssh"`);
  if (via === 'ssh') {
    if (record.ollama !== undefined) {
      throw new Error(`Fleet host "${name}" is reached over SSH. Do not set an ollama URL on it.`);
    }
    const sshName = record.ssh === undefined ? name : requiredString(record.ssh, 'ssh');
    if (!NAME_RE.test(sshName)) throw new Error(`Fleet host "${name}" has an invalid ssh name`);
    return { name, via, sshName };
  }
  let ollamaHost: string | undefined;
  if (record.ollama !== undefined) {
    if (typeof record.ollama !== 'string' || !record.ollama.trim()) {
      throw new Error(`Fleet host "${name}" ollama must be a URL string`);
    }
    let normalized: string;
    try {
      normalized = normalizeOllamaHost(record.ollama);
    } catch {
      throw new Error(`Fleet host "${name}" ollama URL is invalid`);
    }
    if (!isLocalOllamaHost(normalized) || isPaidProviderHost(normalized)) {
      throw new Error(`Fleet host "${name}" ollama must be a local address. Remote machines are checked over SSH.`);
    }
    ollamaHost = normalized;
  }
  return { name, via, ollamaHost };
}

function rejectForbidden(record: Record<string, unknown>, label: string): void {
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`Fleet file ${label} must not store ${field}. Keep secrets out of the fleet file.`);
    }
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Fleet host is missing ${label}`);
  return value.trim();
}
