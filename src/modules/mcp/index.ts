/**
 * M19 MCP client. Stdio servers from ~/.jewbot/mcp.json. Local processes only.
 */

import type { JewbotModule } from '../plugin/types';
import { callServerTool, listServerTools, type McpRpc } from './client';
import { loadMcpServers, setServerAllow, type McpServer } from './config';

export { callServerTool, listServerTools, startStdio } from './client';
export type { McpRpc, McpTool } from './client';
export { assertLocalCommand, loadMcpServers, mcpConfigPath, parseServer, setServerAllow } from './config';
export type { McpServer } from './config';

export async function callConfiguredTool(options: {
  file?: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  rpc?: McpRpc;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; blocked: boolean; text: string }> {
  const servers = loadMcpServers(options.file);
  const server = servers.find((item) => item.name === options.server);
  if (!server) return { ok: false, blocked: false, text: `MCP server not found: ${options.server}` };
  return callServerTool(server, options.tool, options.args ?? {}, options.rpc, options.signal);
}

export function serversForPrompt(file?: string): string {
  const servers = loadMcpServers(file);
  if (!servers.length) return 'MCP: no local servers configured.';
  return servers.map((server) => describeServer(server)).join('\n');
}

export function describeServer(server: McpServer): string {
  return `${server.name} allow=${server.allow ? 'on' : 'off'} command=${server.command}`;
}

export const jewbotModule: JewbotModule = {
  id: 'mcp',
  title: 'MCP client',
  description: 'Stdio MCP servers from ~/.jewbot/mcp.json. Tool calls wait for that server’s allow toggle. Remote URLs are refused.',
  version: '0.4.0',
  capabilities: ['tools', 'local-only'],
  tools: [
    { name: 'mcp_call', description: 'Call one tool on an allowed local stdio MCP server. A server with allow off does not run.' },
  ],
  health() {
    return { ok: true, detail: 'stdio mcp idle' };
  },
};
