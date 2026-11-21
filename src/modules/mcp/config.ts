/**
 * Stdio MCP servers from ~/.jewbot/mcp.json.
 * A server is a local process. A url, token, or password is refused.
 * Tool calls stay off until that server's allow toggle is true.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface McpServer {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  allow: boolean;
}

const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const FORBIDDEN = ['url', 'uri', 'token', 'password', 'passphrase', 'secret', 'apikey', 'api_key', 'authorization'];

export function mcpConfigPath(): string {
  const override = process.env.JEWBOT_MCP_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.jewbot', 'mcp.json');
}

export function loadMcpServers(file = mcpConfigPath()): McpServer[] {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Refusing to read a symlinked MCP config.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const servers = (parsed as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return [];
  return servers.map((entry) => parseServer(entry));
}

export function parseServer(entry: unknown): McpServer {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('MCP server entry must be an object.');
  const record = entry as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN.includes(key.toLowerCase())) throw new Error(`MCP config refuses ${key}. Local stdio only.`);
  }
  const name = String(record.name ?? '');
  if (!NAME_RE.test(name)) throw new Error(`Invalid MCP server name: ${name}`);
  const command = String(record.command ?? '').trim();
  assertLocalCommand(command);
  const args = Array.isArray(record.args) ? record.args.map((arg) => String(arg)) : [];
  if (args.some((arg) => /^\s*https?:\/\//i.test(arg) || /[\n\r]/.test(arg))) {
    throw new Error('MCP args must stay local.');
  }
  const cwd = typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd.trim() : undefined;
  return { name, command, args, cwd, allow: record.allow === true };
}

export function assertLocalCommand(command: string): void {
  if (!command || /[\n\r;&|`$]/.test(command) || /https?:\/\//i.test(command)) {
    throw new Error('MCP command must be a local program, not a URL or a shell line.');
  }
  if (command.includes('..')) throw new Error('MCP command must not climb directories.');
}

export function setServerAllow(name: string, allow: boolean, file = mcpConfigPath()): McpServer[] {
  if (!NAME_RE.test(name)) throw new Error(`Invalid MCP server name: ${name}`);
  const current = fs.existsSync(file) ? readRaw(file) : { servers: [] };
  const servers = Array.isArray(current.servers) ? current.servers : [];
  let found = false;
  for (const entry of servers) {
    if (entry && typeof entry === 'object' && (entry as { name?: string }).name === name) {
      (entry as { allow?: boolean }).allow = allow;
      found = true;
    }
  }
  if (!found) throw new Error(`MCP server not found: ${name}`);
  current.servers = servers;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return loadMcpServers(file);
}

function readRaw(file: string): { servers?: unknown[] } & Record<string, unknown> {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Refusing to read a symlinked MCP config.');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as { servers?: unknown[] };
}
