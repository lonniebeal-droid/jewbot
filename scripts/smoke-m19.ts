/**
 * M19 MCP client. Local stdio only. Tool calls wait for the allow toggle.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callServerTool } from '../src/modules/mcp/client';
import { loadMcpServers, parseServer, setServerAllow } from '../src/modules/mcp/config';
import { callConfiguredTool } from '../src/modules/mcp';
import type { McpRpc } from '../src/modules/mcp';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  let urlRefused = false;
  try {
    parseServer({ name: 'remote', command: 'node', url: 'https://example.com/mcp' });
  } catch (err) {
    urlRefused = /refuses url/i.test(err instanceof Error ? err.message : '');
  }
  expect(urlRefused, 'a url field is refused');
  let shellRefused = false;
  try {
    parseServer({ name: 'bad', command: 'curl https://example.com' });
  } catch (err) {
    shellRefused = /local program/i.test(err instanceof Error ? err.message : '');
  }
  expect(shellRefused, 'a URL command is refused');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m19-'));
  const file = path.join(dir, 'mcp.json');
  process.env.JEWBOT_MCP_FILE = file;
  await fs.writeFile(
    file,
    JSON.stringify({
      note: 'kept',
      servers: [{ name: 'echo', command: process.execPath, args: [path.join(dir, 'server.js')], allow: false }],
    }),
  );
  const calls: string[] = [];
  const rpc: McpRpc = {
    async request(method) {
      calls.push(method);
      return { content: [{ text: 'pong' }] };
    },
  };
  try {
    const blocked = await callConfiguredTool({ server: 'echo', tool: 'ping', rpc });
    expect(blocked.blocked === true && calls.length === 0, blocked.text);
    setServerAllow('echo', true, file);
    const kept = JSON.parse(await fs.readFile(file, 'utf8')) as { note?: string; servers: Array<{ allow: boolean }> };
    expect(kept.note === 'kept' && kept.servers[0].allow === true, 'the toggle keeps other keys');
    const allowed = await callConfiguredTool({ server: 'echo', tool: 'ping', args: {}, rpc });
    expect(allowed.ok === true && allowed.text === 'pong' && calls[0] === 'tools/call', allowed.text);

    await fs.writeFile(
      path.join(dir, 'server.js'),
      `
const { Buffer } = require('buffer');
let buf = Buffer.alloc(0);
function frame(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const nl = buf.indexOf('\\n');
    if (nl < 0) return;
    const line = buf.slice(0, nl).toString('utf8').trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') frame({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } });
    else if (msg.method === 'tools/call') frame({ jsonrpc: '2.0', id: msg.id, result: { content: [{ text: 'stdio-pong' }] } });
  }
});
`,
    );
    const server = loadMcpServers(file)[0];
    const live = await callServerTool(server, 'ping', {});
    expect(live.ok === true && live.text === 'stdio-pong', live.text);

    const renderer = await fs.readFile(path.join(process.cwd(), 'src/renderer/renderer.js'), 'utf8');
    expect(renderer.includes('mcpList'), 'the window lists MCP servers');
  } finally {
    delete process.env.JEWBOT_MCP_FILE;
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log('smoke-m19: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
