/**
 * Local SSH host allowlist and TOFU known-host store.
 * Passwords, passphrases, and private key bytes never belong in these files.
 *
 * Device identity matches ju-device-mesh inventory/devices.json where that file
 * has fields: name (mac, dell, pi, pixel, iphone), tailscale_ip, os, role, status.
 * That inventory has no SSH key path and no hostname. Jewbot keeps privateKeyPath
 * as a path string and adds tailscale_hostname. The key file is not read here.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

export type SshAuthKind = 'key' | 'agent' | 'password';

export interface SshHostConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuthKind;
  privateKeyPath?: string;
  askPassphrase: boolean;
  askPassword: boolean;
  /** ju-device-mesh inventory name: mac, dell, pi, pixel, or iphone. */
  device?: string;
  /** ju-device-mesh field. Tailscale CGNAT address only. Never a key. */
  tailscale_ip?: string;
  /** Jewbot field. The mesh inventory has no hostname. */
  tailscale_hostname?: string;
  os?: string;
  role?: string;
}

export interface SshHostPublic {
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuthKind;
  askPassphrase: boolean;
  askPassword: boolean;
  device?: string;
  tailscale_ip?: string;
  tailscale_hostname?: string;
  os?: string;
  role?: string;
  /** Path only. The key file is never read into this object. */
  privateKeyPath?: string;
}

export interface KnownHostEntry {
  name: string;
  host: string;
  port: number;
  fingerprint: string;
  algorithm: string;
  confirmedAt: string;
}

export interface HostKeyDescription {
  fingerprint: string;
  algorithm: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HOST_RE = /^[A-Za-z0-9_.:-]{1,253}$/;
const FORBIDDEN_FIELDS = ['password', 'passphrase', 'privateKey', 'private_key', 'key', 'secret'] as const;

export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function defaultHostsPath(): string {
  const override = process.env.JEWBOT_SSH_HOSTS?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.jewbot', 'hosts.json');
}

export function defaultKnownHostsPath(): string {
  const override = process.env.JEWBOT_SSH_KNOWN_HOSTS?.trim();
  if (override) return path.resolve(expandHome(override));
  return path.join(os.homedir(), '.jewbot', 'known_hosts.json');
}

export function describeHostKey(key: Buffer): HostKeyDescription {
  let algorithm = 'unknown';
  if (key.length >= 4) {
    const len = key.readUInt32BE(0);
    if (len > 0 && len < 80 && 4 + len <= key.length) {
      const label = key.subarray(4, 4 + len).toString('utf8');
      if (/^[a-z0-9@._-]+$/i.test(label)) algorithm = label;
    }
  }
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
  return { fingerprint: `SHA256:${digest}`, algorithm };
}

export function keyMaterialNeedsPassphrase(text: string): boolean {
  if (/ENCRYPTED PRIVATE KEY/.test(text)) return true;
  if (/Proc-Type:\s*4,ENCRYPTED/i.test(text)) return true;
  if (text.includes('OPENSSH PRIVATE KEY') && /\bbcrypt\b/.test(text)) return true;
  return false;
}

const DEVICE_IDS = new Set(['mac', 'dell', 'pi', 'pixel', 'iphone']);

function isTailscaleIPv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const addr = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
  const start = ((100 << 24) + (64 << 16)) >>> 0;
  const end = ((100 << 24) + (128 << 16)) >>> 0;
  return addr >= start && addr < end;
}

function optionalDevice(record: Record<string, unknown>, name: string): string | undefined {
  const raw = record.device === undefined ? (DEVICE_IDS.has(name) ? name : undefined) : record.device;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !DEVICE_IDS.has(raw)) {
    throw new Error(`Host "${name}" device must be mac, dell, pi, pixel, or iphone`);
  }
  return raw;
}

function optionalText(value: unknown, name: string, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value) || /PRIVATE KEY|BEGIN /.test(value)) {
    throw new Error(`Host "${name}" has an invalid ${label}`);
  }
  return value.trim();
}

export function toPublicHost(cfg: SshHostConfig): SshHostPublic {
  return {
    name: cfg.name,
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    auth: cfg.auth,
    askPassphrase: cfg.askPassphrase,
    askPassword: cfg.askPassword,
    device: cfg.device,
    tailscale_ip: cfg.tailscale_ip,
    tailscale_hostname: cfg.tailscale_hostname,
    os: cfg.os,
    role: cfg.role,
    privateKeyPath: cfg.privateKeyPath,
  };
}

export function loadHostsFile(filePath: string): { hosts: SshHostConfig[]; error: string | null } {
  if (!fs.existsSync(filePath)) return { hosts: [], error: null };
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { hosts: [], error: `Could not read SSH hosts file: ${err instanceof Error ? err.message : 'unreadable'}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { hosts: [], error: 'SSH hosts file is not valid JSON. Secrets were not logged.' };
  }
  try {
    return { hosts: parseHostsDocument(parsed, filePath), error: null };
  } catch (err) {
    return { hosts: [], error: err instanceof Error ? err.message : 'Invalid SSH hosts file' };
  }
}

export function parseHostsDocument(parsed: unknown, sourceLabel: string): SshHostConfig[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`SSH hosts file ${sourceLabel} must be an object with a hosts array`);
  }
  const hosts = (parsed as { hosts?: unknown }).hosts;
  if (!Array.isArray(hosts)) throw new Error(`SSH hosts file ${sourceLabel} is missing a hosts array`);
  if (hosts.length > 100) throw new Error('SSH hosts file has too many entries');
  const seen = new Set<string>();
  return hosts.map((entry, index) => parseHostEntry(entry, index, seen));
}

export function readKnownHosts(filePath: string): KnownHostEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const entries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(isKnownHostEntry);
  } catch {
    return [];
  }
}

export function writeKnownHost(filePath: string, entry: KnownHostEntry): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // The directory may be owned in a way chmod cannot change. The file mode below still applies.
  }
  const entries = readKnownHosts(filePath).filter((row) => !(row.host === entry.host && row.port === entry.port));
  entries.push(entry);
  const body = JSON.stringify({ entries }, null, 2) + '\n';
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, 0o600);
}

export function parseHostEntry(entry: unknown, index: number, seen: Set<string>): SshHostConfig {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`SSH host at index ${index} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      const name = typeof record.name === 'string' ? record.name : `#${index}`;
      throw new Error(
        `Host "${name}" must not store ${field} in the hosts file. Use privateKeyPath, agent, or an in-memory prompt.`,
      );
    }
  }
  const name = requiredString(record.name, 'name');
  if (!NAME_RE.test(name)) throw new Error(`Host name "${name}" must be letters, digits, dot, underscore, or dash`);
  if (seen.has(name)) throw new Error(`Duplicate SSH host name: ${name}`);
  seen.add(name);
  const host = requiredString(record.host, 'host');
  if (!HOST_RE.test(host)) throw new Error(`Host "${name}" has an invalid host value`);
  const port = record.port === undefined ? 22 : record.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Host "${name}" has an invalid port`);
  }
  const username = requiredString(record.username, 'username');
  if (username.length > 128 || /[\s\r\n]/.test(username)) throw new Error(`Host "${name}" has an invalid username`);
  const agent = record.agent === true;
  const askPassword = record.askPassword === true;
  const askPassphrase = record.askPassphrase === true;
  let privateKeyPath: string | undefined;
  if (record.privateKeyPath !== undefined) {
    if (typeof record.privateKeyPath !== 'string' || !record.privateKeyPath.trim()) {
      throw new Error(`Host "${name}" privateKeyPath must be a path string`);
    }
    privateKeyPath = path.resolve(expandHome(record.privateKeyPath.trim()));
  }
  let auth: SshAuthKind;
  if (askPassword && !privateKeyPath && !agent) auth = 'password';
  else if (agent && !privateKeyPath) auth = 'agent';
  else if (privateKeyPath) auth = 'key';
  else throw new Error(`Host "${name}" needs privateKeyPath, agent: true, or askPassword: true`);
  if (askPassphrase && !privateKeyPath) {
    throw new Error(`Host "${name}" askPassphrase requires privateKeyPath`);
  }
  const device = optionalDevice(record, name);
  const tailscale_ip = optionalText(record.tailscale_ip, name, 'tailscale_ip');
  if (tailscale_ip && !isTailscaleIPv4(tailscale_ip)) {
    throw new Error(`Host "${name}" tailscale_ip must be inside 100.64.0.0/10`);
  }
  const tailscale_hostname = optionalText(record.tailscale_hostname, name, 'tailscale_hostname');
  const osName = optionalText(record.os, name, 'os');
  const role = optionalText(record.role, name, 'role');
  return {
    name,
    host,
    port,
    username,
    auth,
    privateKeyPath,
    askPassphrase,
    askPassword: auth === 'password' || askPassword,
    device,
    tailscale_ip,
    tailscale_hostname,
    os: osName,
    role,
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SSH host is missing ${label}`);
  return value.trim();
}

function isKnownHostEntry(value: unknown): value is KnownHostEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === 'string' &&
    typeof row.host === 'string' &&
    typeof row.port === 'number' &&
    typeof row.fingerprint === 'string' &&
    row.fingerprint.startsWith('SHA256:') &&
    typeof row.algorithm === 'string' &&
    typeof row.confirmedAt === 'string'
  );
}
