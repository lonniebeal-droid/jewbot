/**
 * Queue a headless task on a LAN SSH host.
 * The remote command only talks to Ollama on 127.0.0.1 of that host.
 * The result is a diff. Nothing is written until Accept.
 */

import { createTwoFilesPatch } from 'diff';
import { isPaidProviderHost, isRoutableFreeHost } from '../llm/ollama';
import type { FileWorkspace } from '../files';

export interface BackgroundHost {
  name: string;
  host: string;
}

export interface BackgroundRunner {
  exec(host: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}

export interface BackgroundFile {
  path: string;
  content: string;
}

export interface BackgroundTask {
  id: string;
  host: string;
  model: string;
  goal: string;
  status: 'queued' | 'review' | 'blocked' | 'applied';
  command?: string;
  diff?: string;
  files?: BackgroundFile[];
  error?: string;
}

export function assertBackgroundHost(address: string): void {
  const name = address.trim().toLowerCase();
  if (!name || /[\s/]/.test(name)) throw new Error(`Invalid host: ${address}`);
  const url = `http://${name}/`;
  if (isPaidProviderHost(url)) throw new Error(`Paid host refused: ${address}`);
  if (isRoutableFreeHost(url)) return;
  if (/^[a-z0-9]([a-z0-9-]{0,62})?$/.test(name)) return;
  throw new Error(`Host is not local or LAN: ${address}`);
}

export function remoteChatCommand(model: string, goal: string): string {
  const cleanModel = model.trim();
  if (!cleanModel || /\s/.test(cleanModel)) throw new Error('Invalid model name');
  const body = JSON.stringify({
    model: cleanModel,
    stream: false,
    messages: [
      {
        role: 'system',
        content: 'Return only JSON {"files":[{"path":"relative/file.txt","content":"full new text"}]}. Do not write files.',
      },
      { role: 'user', content: goal },
    ],
  });
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  return `printf %s ${shellQuote(encoded)} | base64 -d | curl -sS http://127.0.0.1:11434/api/chat -H content-type:application/json --data-binary @-`;
}

export function enqueueBackgroundTask(host: BackgroundHost, model: string, goal: string): BackgroundTask {
  assertBackgroundHost(host.host);
  if (!goal.trim()) throw new Error('Empty goal');
  return {
    id: `bg_${Math.random().toString(16).slice(2, 10)}`,
    host: host.name,
    model: model.trim(),
    goal,
    status: 'queued',
  };
}

export async function runBackgroundTask(task: BackgroundTask, host: BackgroundHost, runner: BackgroundRunner): Promise<BackgroundTask> {
  assertBackgroundHost(host.host);
  if (host.name !== task.host) throw new Error('Host does not match the queued task');
  const command = remoteChatCommand(task.model, task.goal);
  const result = await runner.exec(host.name, command);
  const parsed = parseFiles(result.stdout);
  if (!parsed) {
    return { ...task, status: 'blocked', command, error: result.stderr || 'The remote model did not return files.' };
  }
  return {
    ...task,
    status: 'review',
    command,
    files: parsed,
    diff: parsed.map((file) => createTwoFilesPatch(file.path, file.path, '', file.content, 'current', 'proposed', { context: 2 })).join('\n'),
  };
}

export async function acceptBackgroundTask(task: BackgroundTask, files: FileWorkspace, confirmed: boolean): Promise<BackgroundTask> {
  if (confirmed !== true) throw new Error('Apply requires confirmation');
  if (task.status !== 'review' || !task.files?.length) throw new Error('Nothing to apply');
  for (const file of task.files) {
    const preview = await files.proposeEdit(file.path, file.content);
    await files.applyEdit(preview, true);
  }
  return { ...task, status: 'applied' };
}

export function parseFiles(stdout: string): BackgroundFile[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  let payload = trimmed;
  try {
    const outer = JSON.parse(trimmed) as { message?: { content?: string } };
    if (typeof outer.message?.content === 'string') payload = outer.message.content;
  } catch {
    // the body itself may already be the files JSON
  }
  const start = payload.indexOf('{');
  const end = payload.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(payload.slice(start, end + 1)) as { files?: Array<{ path?: string; content?: string }> };
    const files = (parsed.files || [])
      .filter((file) => typeof file.path === 'string' && typeof file.content === 'string' && !file.path.includes('..'))
      .map((file) => ({ path: file.path as string, content: file.content as string }));
    return files.length ? files : null;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
