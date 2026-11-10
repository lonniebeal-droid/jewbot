/**
 * Ollama host registry for LAN routing.
 *
 * Order is the fallback order. `JEWBOT_OLLAMA_HOSTS` wins when it is set.
 * Otherwise Jewbot reads `~/.jewbot/ollama-hosts.json`, then
 * `<project>/.jewbot/ollama-hosts.json`. With neither, the only host is
 * `http://127.0.0.1:11434`.
 *
 * This file does not open a socket and does not read SSH keys.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expandHome } from '../ssh/config';
import { normalizeOllamaHost } from './ollama';

export interface OllamaHostEntry {
  name: string;
  /** Normalized base URL. Empty when the entry could not be parsed. */
  host: string;
  error?: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_HOSTS = 32;
const FORBIDDEN = ['password', 'passphrase', 'privateKey', 'private_key', 'secret', 'token', 'apiKey', 'api_key', 'credential', 'credentials'];

export const DEFAULT_OLLAMA_HOST_ENTRY: OllamaHostEntry = {
  name: 'local',
  host: 'http://127.0.0.1:11434',
};

export function defaultOllamaHostsPath(): string {
  const override = process.env.JEWBOT_OLLAMA_HOSTS_FILE?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.jewbot', 'ollama-hosts.json');
}

export function projectOllamaHostsPath(root?: string): string {
  const base = (root ?? process.env.JEWBOT_PROJECT_ROOT ?? process.cwd()).trim() || process.cwd();
  return path.join(path.resolve(base), '.jewbot', 'ollama-hosts.json');
}

export interface LoadHostsOptions {
  /** When set, including an empty string, this is the env list. `undefined` reads the process env. */
  env?: string;
  /** Explicit file. `undefined` uses the home file, then the project file. */
  filePath?: string;
  /** Skip the filesystem. Used when the env list is the whole registry. */
  skipFile?: boolean;
}

/**
 * Registry in fallback order. Does not check the spend gate; the router does
 * that before any `/api/tags` call.
 */
export function loadOllamaHosts(options: LoadHostsOptions = {}): OllamaHostEntry[] {
  const env = options.env !== undefined ? options.env : process.env.JEWBOT_OLLAMA_HOSTS;
  if (env !== undefined && env.trim()) return parseHostList(env);
  if (options.skipFile) return [{ ...DEFAULT_OLLAMA_HOST_ENTRY }];
  const filePath = options.filePath !== undefined ? options.filePath : firstExistingHostsFile();
  if (!filePath || !fs.existsSync(filePath)) return [{ ...DEFAULT_OLLAMA_HOST_ENTRY }];
  return parseHostFile(filePath);
}

export function parseHostList(raw: string): OllamaHostEntry[] {
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return [{ ...DEFAULT_OLLAMA_HOST_ENTRY }];
  if (parts.length > MAX_HOSTS) throw new Error('JEWBOT_OLLAMA_HOSTS has too many hosts.');
  const seen = new Set<string>();
  return parts.map((part, index) => {
    const eq = part.indexOf('=');
    const name = eq === -1 ? `host${index + 1}` : part.slice(0, eq).trim();
    const url = eq === -1 ? part : part.slice(eq + 1).trim();
    return entryFrom(name, url, seen);
  });
}

export function parseHostFile(filePath: string): OllamaHostEntry[] {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Ollama host file must be a regular file. It was not read.');
  }
  if (stat.size > 64 * 1024) throw new Error('Ollama host file is too large. It was not read.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('Ollama host file is not valid JSON. It was not read.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ollama host file must be an object with a hosts array.');
  }
  const body = parsed as Record<string, unknown>;
  rejectForbidden(body, 'ollama host file');
  if (!Array.isArray(body.hosts)) throw new Error('Ollama host file is missing a hosts array.');
  if (body.hosts.length > MAX_HOSTS) throw new Error('Ollama host file has too many hosts.');
  const seen = new Set<string>();
  return body.hosts.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Ollama host at index ${index} must be an object.`);
    }
    const row = item as Record<string, unknown>;
    rejectForbidden(row, `host ${index}`);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const urlValue = row.host ?? row.url;
    const url = typeof urlValue === 'string' ? urlValue.trim() : '';
    return entryFrom(name, url, seen);
  });
}

function firstExistingHostsFile(): string | null {
  const home = defaultOllamaHostsPath();
  if (fs.existsSync(home)) return home;
  const project = projectOllamaHostsPath();
  if (fs.existsSync(project)) return project;
  return null;
}

function entryFrom(name: string, url: string, seen: Set<string>): OllamaHostEntry {
  if (!NAME_RE.test(name)) {
    return { name: name || 'invalid', host: '', error: `Invalid host name "${name}".` };
  }
  if (seen.has(name)) throw new Error(`Duplicate Ollama host name: ${name}`);
  seen.add(name);
  if (!url) return { name, host: '', error: `Ollama host "${name}" is missing a URL.` };
  try {
    return { name, host: normalizeOllamaHost(url) };
  } catch {
    return { name, host: '', error: `Ollama host "${name}" has an invalid URL.` };
  }
}

function rejectForbidden(record: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN.includes(key)) {
      throw new Error(`${label} must not contain ${key}. The host file was not used.`);
    }
  }
}
