/**
 * A small stdio MCP client. Messages are newline-delimited JSON-RPC,
 * one JSON-RPC message per line, per the MCP stdio transport.
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
  signal?: AbortSignal,
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
  if (signal?.aborted) {
    return { ok: false, blocked: false, text: 'Cancelled: the MCP tool call was cancelled before it ran.' };
  }
  const owned = rpc ?? startStdio(server, signal);
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

export function startStdio(server: McpServer, signal?: AbortSignal): McpRpc {
  const child = spawn(server.command, server.args, {
    cwd: server.cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  let buffer = Buffer.alloc(0);
  const waiters = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let closed = false;
  let closeError: Error | null = null;
  const failTransport = (err: Error): void => {
    if (closed) return;
    closed = true;
    closeError = err;
    signal?.removeEventListener('abort', onAbort);
    for (const waiter of waiters.values()) waiter.reject(err);
    waiters.clear();
  };
  const onAbort = (): void => {
    failTransport(new Error('MCP request cancelled'));
    child.kill();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const take = (): void => {
    for (;;) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = buffer.slice(0, newline).toString('utf8').trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
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
    failTransport(err);
  });
  child.on('close', (code) => {
    failTransport(new Error(`MCP server exited (code ${code ?? 'unknown'}) before replying`));
  });
  const send = (payload: unknown): void => {
    if (closed) throw closeError ?? new Error('MCP server is closed');
    child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
  };
  return {
    request(method, params) {
      if (signal?.aborted) return Promise.reject(new Error('MCP request cancelled'));
      if (closed) return Promise.reject(closeError ?? new Error('MCP server is closed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject });
        try {
          send({ jsonrpc: '2.0', id, method, params: params ?? {} });
        } catch (err) {
          waiters.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    notify(method, params) {
      if (closed) return;
      try {
        send({ jsonrpc: '2.0', method, params: params ?? {} });
      } catch {
        // Notifications are fire-and-forget; a dead transport drops them.
      }
    },
    close() {
      failTransport(new Error('MCP client closed'));
      child.stdin.end();
      child.kill();
    },
  };
}
