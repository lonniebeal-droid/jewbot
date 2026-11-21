/**
 * A small stdio MCP client. Frames are Content-Length messages.
 * Tool calls do not start a process unless that server's allow toggle is on.
 */

import { spawn } from 'child_process';
import type { McpServer } from './config';

export interface McpRpc {
  request(method: string, params?: unknown): Promise<unknown>;
  notify?(method: string, params?: unknown): void;
  close?(): void;
}

export interface McpTool {
  name: string;
  description?: string;
}

let nextId = 1;

export async function callServerTool(
  server: McpServer,
  tool: string,
  args: Record<string, unknown>,
  rpc?: McpRpc,
): Promise<{ ok: boolean; blocked: boolean; text: string }> {
  if (server.allow !== true) {
    return {
      ok: false,
      blocked: true,
      text: `BLOCKED: MCP server ${server.name} is not allowed. Turn on its allow toggle before a tool call.`,
    };
  }
  const name = tool.trim();
  if (!name || /[\n\r]/.test(name)) return { ok: false, blocked: false, text: 'Invalid MCP tool name.' };
  const owned = rpc ?? startStdio(server);
  try {
    if (!rpc) await handshake(owned);
    const result = await owned.request('tools/call', { name, arguments: args });
    return { ok: true, blocked: false, text: formatToolResult(result) };
  } finally {
    if (!rpc) owned.close?.();
  }
}

export async function listServerTools(server: McpServer, rpc?: McpRpc): Promise<McpTool[]> {
  const owned = rpc ?? startStdio(server);
  try {
    if (!rpc) await handshake(owned);
    const result = (await owned.request('tools/list', {})) as { tools?: McpTool[] };
    return Array.isArray(result?.tools) ? result.tools : [];
  } finally {
    if (!rpc) owned.close?.();
  }
}

async function handshake(rpc: McpRpc): Promise<void> {
  await rpc.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'jewbot', version: '0.4.0' },
  });
  rpc.notify?.('notifications/initialized', {});
}

export function formatToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const content = (result as { content?: Array<{ text?: string }> }).content;
  if (Array.isArray(content)) {
    const text = content.map((part) => part?.text ?? '').filter(Boolean).join('\n');
    if (text) return text;
  }
  return JSON.stringify(result);
}

export function startStdio(server: McpServer): McpRpc {
  const child = spawn(server.command, server.args, {
    cwd: server.cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let buffer = Buffer.alloc(0);
  const waiters = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  const take = (): void => {
    while (buffer.length) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString('utf8');
      buffer = buffer.slice(start + length);
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(body) as { id?: number; result?: unknown; error?: { message?: string } };
      } catch {
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const waiter = waiters.get(message.id);
      if (!waiter) continue;
      waiters.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'MCP error'));
      else waiter.resolve(message.result);
    }
  };
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    take();
  });
  child.on('error', (err) => {
    for (const waiter of waiters.values()) waiter.reject(err);
    waiters.clear();
  });
  const send = (payload: unknown): void => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  };
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject });
        send({ jsonrpc: '2.0', id, method, params: params ?? {} });
      });
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params: params ?? {} });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}
