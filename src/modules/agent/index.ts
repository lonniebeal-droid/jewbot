/**
 * Agentic loop: plan → act → observe → iterate (Cursor-style).
 */

import { chatOnce, ChatMessage, defaultOllamaConfig, OllamaConfig } from '../llm';
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

export interface AgentDeps {
  files: FileWorkspace;
  terminal: TerminalSession;
  ssh: SshManager;
  context: ContextIndexer;
  llm?: OllamaConfig;
  maxSteps?: number;
}

const SYSTEM = `You are Jewbot, a local coding agent. Prefer Ollama/local tools. Respond with either:
(1) a short plan and a single JSON tool call on its own line: {"tool":"name","args":{...}}
(2) or FINAL: <answer> when done.
Tools: list_dir, read_file, propose_edit, run_terminal, ssh_exec, ask_owner.
Never claim you ran a command without a tool call. $0 spend — no paid APIs.`;

export class AgentLoop {
  status: AgentStatus = 'idle';
  constructor(private deps: AgentDeps) {}

  async run(goal: string): Promise<AgentRunResult> {
    const steps: AgentStep[] = [];
    const maxSteps = this.deps.maxSteps ?? 12;
    const cfg = this.deps.llm ?? defaultOllamaConfig();
    const summary = await this.deps.context.summarize();
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `${this.deps.context.formatForPrompt(summary)}\n\nGoal:\n${goal}`,
      },
    ];

    for (let n = 1; n <= maxSteps; n++) {
      this.status = 'planning';
      let reply: string;
      try {
        reply = await chatOnce(messages, cfg);
      } catch (err) {
        this.status = 'blocked';
        return {
          status: 'blocked',
          steps,
          blockReason: err instanceof Error ? err.message : String(err),
        };
      }

      if (/\bFINAL:\s*/i.test(reply)) {
        this.status = 'done';
        const finalText = reply.replace(/^[\s\S]*?\bFINAL:\s*/i, '').trim();
        steps.push({ n, thought: reply, observation: 'final' });
        return { status: 'done', steps, finalText };
      }

      const tool = parseTool(reply);
      if (!tool) {
        messages.push({ role: 'assistant', content: reply });
        messages.push({
          role: 'user',
          content: 'No tool call found. Emit a JSON tool call or FINAL: …',
        });
        steps.push({ n, thought: reply });
        continue;
      }

      this.status = 'acting';
      const observation = await this.dispatch(tool);
      this.status = 'observing';
      steps.push({ n, thought: reply, tool, observation });
      messages.push({ role: 'assistant', content: reply });
      messages.push({ role: 'user', content: `OBSERVE:\n${observation}` });

      if (tool.name === 'ask_owner') {
        this.status = 'blocked';
        return { status: 'blocked', steps, blockReason: observation };
      }
    }

    this.status = 'blocked';
    return { status: 'blocked', steps, blockReason: 'max steps reached' };
  }

  private async dispatch(tool: AgentToolCall): Promise<string> {
    try {
      switch (tool.name) {
        case 'list_dir': {
          const rel = String(tool.args.path ?? '.');
          const entries = await this.deps.files.listDir(rel);
          return entries.join('\n');
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
          return `Unknown tool: ${tool.name}`;
      }
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

function parseTool(text: string): AgentToolCall | null {
  const match = text.match(/\{[\s\S]*"tool"\s*:\s*"[^"]+"[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { tool?: string; args?: Record<string, unknown> };
    if (!obj.tool) return null;
    return { name: obj.tool, args: obj.args ?? {} };
  } catch {
    return null;
  }
}
