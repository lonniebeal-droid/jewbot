/**
 * Agentic loop: plan → act → observe → iterate (Cursor-style).
 * M1 live tools: list_dir, read_file. Other tools stay wired but gated by Safety.
 */

import { chatStream, ChatMessage, defaultOllamaConfig, OllamaConfig } from '../llm';
import { FileWorkspace } from '../files';
import { TerminalSession } from '../terminal';
import { SshManager } from '../ssh';
import { ContextIndexer } from '../context';

export type AgentStatus = 'idle' | 'planning' | 'acting' | 'observing' | 'done' | 'blocked';

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentStep {
  n: number;
  thought?: string;
  tool?: AgentToolCall;
  observation?: string;
}

export interface AgentRunResult {
  status: AgentStatus;
  steps: AgentStep[];
  finalText?: string;
  blockReason?: string;
}

export type AgentStreamEvent =
  | { type: 'status'; status: AgentStatus }
  | { type: 'token'; text: string }
  | { type: 'message_done'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; args: Record<string, unknown>; observation: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult };

export interface AgentDeps {
  files: FileWorkspace;
  terminal: TerminalSession;
  ssh: SshManager;
  context: ContextIndexer;
  llm?: OllamaConfig;
  maxSteps?: number;
}

const OBSERVATION_MAX = 12_000;

const SYSTEM = `You are Jewbot, a local coding agent. $0 spend — Ollama only, no paid APIs.
Loop: think briefly, ACT with exactly one tool, then you will receive OBSERVE.
When the goal is satisfied, reply with a line starting with FINAL: and the answer. Do not invent file contents.

Live tools (paths stay inside the project root):
- list_dir  {"tool":"list_dir","args":{"path":"."}}
- read_file {"tool":"read_file","args":{"path":"relative/file.txt"}}

Put the JSON object on its own line. One tool per turn.
ask_owner pauses for a human. Do not claim a tool ran unless you emitted its JSON.`;

export class AgentLoop {
  status: AgentStatus = 'idle';
  constructor(private deps: AgentDeps) {}

  async run(goal: string, signal?: AbortSignal): Promise<AgentRunResult> {
    let result: AgentRunResult | undefined;
    for await (const ev of this.runStream(goal, signal)) {
      if (ev.type === 'done') result = ev.result;
    }
    return result ?? { status: 'blocked', steps: [], blockReason: 'agent produced no result' };
  }

  async *runStream(goal: string, signal?: AbortSignal): AsyncGenerator<AgentStreamEvent, void, unknown> {
    const finish = (result: AgentRunResult): AgentStreamEvent => {
      this.status = result.status;
      return { type: 'done', result };
    };

    if (!goal.trim()) {
      const result: AgentRunResult = { status: 'blocked', steps: [], blockReason: 'Empty goal' };
      yield { type: 'error', message: result.blockReason! };
      yield finish(result);
      return;
    }
    if (signal?.aborted) {
      const result: AgentRunResult = { status: 'blocked', steps: [], blockReason: 'Cancelled' };
      yield { type: 'error', message: 'Cancelled' };
      yield finish(result);
      return;
    }

    const steps: AgentStep[] = [];
    const maxSteps = this.deps.maxSteps ?? 12;
    const cfg = this.deps.llm ?? defaultOllamaConfig();

    let summary;
    try {
      summary = await this.deps.context.summarize();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: AgentRunResult = { status: 'blocked', steps, blockReason: message };
      yield { type: 'error', message };
      yield finish(result);
      return;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${this.deps.context.formatForPrompt(summary)}\n\nGoal:\n${goal}`,
      },
    ];

    for (let n = 1; n <= maxSteps; n++) {
      if (signal?.aborted) {
        const result: AgentRunResult = { status: 'blocked', steps, blockReason: 'Cancelled' };
        yield { type: 'error', message: 'Cancelled' };
        yield finish(result);
        return;
      }

      this.status = 'planning';
      yield { type: 'status', status: 'planning' };

      let reply = '';
      try {
        for await (const token of chatStream(messages, cfg, { signal })) {
          reply += token;
          yield { type: 'token', text: token };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.status = 'blocked';
        const result: AgentRunResult = { status: 'blocked', steps, blockReason: message };
        yield { type: 'error', message };
        yield finish(result);
        return;
      }

      yield { type: 'message_done', text: reply };

      if (/\bFINAL:\s*/i.test(reply)) {
        const finalText = reply.replace(/^[\s\S]*?\bFINAL:\s*/i, '').trim();
        steps.push({ n, thought: reply, observation: 'final' });
        this.status = 'done';
        yield { type: 'final', text: finalText };
        yield finish({ status: 'done', steps, finalText });
        return;
      }

      const tool = parseToolCall(reply);
      if (!tool) {
        messages.push({ role: 'assistant', content: reply });
        messages.push({
          role: 'user',
          content: 'No tool call found. Emit one JSON tool call or a line starting with FINAL: …',
        });
        steps.push({ n, thought: reply });
        continue;
      }

      this.status = 'acting';
      yield { type: 'status', status: 'acting' };
      yield { type: 'tool_call', name: tool.name, args: tool.args };

      const observation = truncate(await this.dispatch(tool), OBSERVATION_MAX);
      this.status = 'observing';
      yield { type: 'status', status: 'observing' };
      yield { type: 'tool_result', name: tool.name, args: tool.args, observation };
      steps.push({ n, thought: reply, tool, observation });
      messages.push({ role: 'assistant', content: reply });
      messages.push({ role: 'user', content: `OBSERVE:\n${observation}` });

      if (tool.name === 'ask_owner') {
        const result: AgentRunResult = { status: 'blocked', steps, blockReason: observation };
        yield { type: 'error', message: observation };
        yield finish(result);
        return;
      }
    }

    const result: AgentRunResult = { status: 'blocked', steps, blockReason: 'max steps reached' };
    yield { type: 'error', message: 'max steps reached' };
    yield finish(result);
  }

  private async dispatch(tool: AgentToolCall): Promise<string> {
    try {
      switch (tool.name) {
        case 'list_dir': {
          const rel = String(tool.args.path ?? '.');
          const entries = await this.deps.files.listDir(rel);
          return entries.length ? entries.join('\n') : '(empty directory)';
        }
        case 'read_file': {
          const rel = String(tool.args.path ?? '');
          return await this.deps.files.read(rel);
        }
        case 'propose_edit': {
          const rel = String(tool.args.path ?? '');
          const content = String(tool.args.content ?? '');
          const preview = await this.deps.files.proposeEdit(rel, content);
          return preview.unifiedDiff;
        }
        case 'run_terminal': {
          const cmd = String(tool.args.command ?? '');
          const result = await this.deps.terminal.run(cmd, {
            cwd: this.deps.files.projectRoot,
            approved: Boolean(tool.args.approved),
            executionId: tool.args.executionId ? String(tool.args.executionId) : undefined,
            requireApproval: Boolean(tool.args.requireApproval),
          });
          return JSON.stringify(result);
        }
        case 'ssh_exec': {
          const host = String(tool.args.host ?? '');
          const cmd = String(tool.args.command ?? '');
          const result = await this.deps.ssh.exec(host, cmd, {
            approved: Boolean(tool.args.approved),
            executionId: tool.args.executionId ? String(tool.args.executionId) : undefined,
          });
          return JSON.stringify(result);
        }
        case 'ask_owner':
          return String(tool.args.question ?? 'Owner input required');
        default:
          return `Unknown tool: ${tool.name}. Live tools: list_dir, read_file.`;
      }
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function parseToolCall(text: string): AgentToolCall | null {
  const sources: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence: RegExpExecArray | null;
  while ((fence = fenceRe.exec(text))) sources.push(fence[1]);
  sources.push(text);

  for (const src of sources) {
    for (const raw of scanJsonObjects(src)) {
      try {
        const obj = JSON.parse(raw) as { tool?: unknown; args?: unknown };
        if (typeof obj.tool !== 'string' || !obj.tool) continue;
        const args =
          obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
            ? (obj.args as Record<string, unknown>)
            : {};
        return { name: obj.tool, args };
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

function scanJsonObjects(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return found;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}
