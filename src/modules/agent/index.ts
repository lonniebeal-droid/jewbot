/**
 * Agentic loop: plan → act → observe → iterate (Cursor-style).
 * Live tools: list_dir, read_file, write_file / propose_edit / apply_edit, run_terminal.
 * File writes preview a diff and land only after the owner accepts.
 */

import { chatStream, ChatMessage, defaultOllamaConfig, OllamaConfig } from '../llm';
import { DiffPreview, EditSpec, FileWorkspace, SecretPathError } from '../files';
import { formatTerminalObservation, TerminalResult, TerminalSession } from '../terminal';
import { checkFleet, formatFleetHealth, formatFleetList, listFleet } from '../fleet-triage';
import {
  formatPortfolioList,
  formatPortfolioMark,
  formatPortfolioNext,
  portfolioListGates,
  portfolioMarkGate,
  portfolioNextFree,
} from '../portfolio-sweeper';
import {
  formatMusicList,
  formatMusicNext,
  formatMusicRelease,
  musicListReleases,
  musicMark,
  musicNextFree,
  type MusicGateFlags,
} from '../music-release';
import { formatSshObservation, HostKeyPrompt, SecretPrompt, SshExecResult, SshManager } from '../ssh';
import { ContextIndexer, formatFindResult, formatSearchResult } from '../context';
import { checkShellCommand, issueConfirmation } from '../safety';

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
  | { type: 'terminal_chunk'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'ssh_chunk'; stream: 'stdout' | 'stderr'; text: string; host?: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; result: AgentRunResult };

export interface DestructiveConfirmRequest {
  command: string;
  reason: string;
  category: string;
}

export interface EditConfirmRequest {
  editId: string;
  path: string;
  unifiedDiff: string;
  created: boolean;
  secret: boolean;
  tool: string;
}

export interface SecretConfirmRequest {
  path: string;
  reason: string;
}

export interface ReleaseDoneConfirmRequest {
  id: string;
  title: string;
  artist: string;
}

export interface AgentDeps {
  files: FileWorkspace;
  terminal: TerminalSession;
  ssh: SshManager;
  context: ContextIndexer;
  llm?: OllamaConfig;
  maxSteps?: number;
  /**
   * Human gate for destructive `run_terminal` commands.
   * Missing callback or a false result means the command is not executed.
   * The model cannot satisfy this gate by setting args.approved.
   */
  confirmDestructive?: (req: DestructiveConfirmRequest) => Promise<boolean>;
  /**
   * Human gate for file writes. Missing callback or false means nothing is written.
   * The model cannot satisfy this gate by setting args.confirmed / args.approved.
   */
  confirmEdit?: (req: EditConfirmRequest) => Promise<boolean>;
  /** Human gate before reading .env / key material. Missing callback means refuse. */
  confirmSecret?: (req: SecretConfirmRequest) => Promise<boolean>;
  /**
   * Human gate before a music release is marked done. Missing callback or a
   * false result means the release is not marked done. The model cannot
   * satisfy this gate by setting args.confirmed / args.approved.
   */
  confirmReleaseDone?: (req: ReleaseDoneConfirmRequest) => Promise<boolean>;
  /** Fired after a write lands, so the UI can undo that edit id on this workspace. */
  onEditApplied?: (editId: string, workspace: FileWorkspace) => void;
  /**
   * Human gate for an unseen or changed SSH host key. Missing callback or false
   * means the connection is refused. The model cannot satisfy this gate.
   */
  confirmHostKey?: (req: HostKeyPrompt) => Promise<boolean>;
  /**
   * Asks the owner for a passphrase or password. The value stays in the SSH
   * session memory and is not returned to the model. Null cancels the connect.
   */
  promptSshSecret?: (req: SecretPrompt) => Promise<string | null>;
}

const OBSERVATION_MAX = 12_000;

function musicFlags(args: Record<string, unknown>): MusicGateFlags {
  return {
    intent: typeof args.intent === 'string' ? args.intent : undefined,
    upload: args.upload === true,
    pay: args.pay === true,
    login: args.login === true,
    distribute: args.distribute === true,
  };
}

const SYSTEM = `You are Jewbot, a local coding agent. $0 spend — Ollama only, no paid APIs.
Loop: think briefly, ACT with exactly one tool, then you will receive OBSERVE.
When the goal is satisfied, reply with a line starting with FINAL: and the answer. Do not invent file contents.

Live tools (paths stay inside the project root; the shell cwd is the project root):
- get_project_summary {"tool":"get_project_summary","args":{}}
- find_files {"tool":"find_files","args":{"query":"**/*.ts"}}
- search_context {"tool":"search_context","args":{"query":"symbol or text","path":"src"}}
- search_files is an alias of search_context
- list_dir  {"tool":"list_dir","args":{"path":"."}}
- read_file {"tool":"read_file","args":{"path":"relative/file.txt"}}
- write_file {"tool":"write_file","args":{"path":"relative/file.txt","content":"full new file text"}}
- apply_edit {"tool":"apply_edit","args":{"path":"relative/file.txt","search":"exact unique text","replace":"new text"}}
- propose_edit accepts either content or search/replace (same gate as write_file)
- run_terminal {"tool":"run_terminal","args":{"command":"echo hello"}}
- ssh_list_hosts {"tool":"ssh_list_hosts","args":{}}
- ssh_connect {"tool":"ssh_connect","args":{"host":"pi"}}
- ssh_exec {"tool":"ssh_exec","args":{"host":"pi","command":"uname -a"}}
- ssh_disconnect {"tool":"ssh_disconnect","args":{"host":"pi"}}
- fleet_list {"tool":"fleet_list","args":{}}
- fleet_health {"tool":"fleet_health","args":{}}
- fleet_health {"tool":"fleet_health","args":{"host":"pi"}}
- portfolio_list_gates {"tool":"portfolio_list_gates","args":{}}
- portfolio_next_free {"tool":"portfolio_next_free","args":{}}
- portfolio_mark_gate {"tool":"portfolio_mark_gate","args":{"id":"local-change-report","status":"done"}}
- music_list_releases {"tool":"music_list_releases","args":{}}
- music_next_free {"tool":"music_next_free","args":{}}
- music_next_free {"tool":"music_next_free","args":{"draft":true}}
- music_mark {"tool":"music_mark","args":{"id":"rel_…","status":"done"}}

The user message starts with a compact project tree and, when the goal names a file or symbol, a few excerpts. That is not the whole repo. Secret files are not in the index. Use find_files and search_context before guessing paths.
Put the JSON object on its own line. One tool per turn.
write_file, propose_edit, and apply_edit show a unified diff and do not change the file until the owner presses Accept. If OBSERVE says REJECTED or UNCHANGED, nothing was written — do not claim it was. You cannot approve your own edit.
Secret paths (.env, private keys) are refused until the owner confirms. Do not expect their existing contents in OBSERVE.
run_terminal streams stdout and stderr back as OBSERVE. You cannot approve your own command.
ssh_list_hosts shows configured hosts only. ssh_connect opens one of those hosts. The first connection asks the owner to confirm the host key fingerprint. ssh_exec streams remote stdout and stderr and uses the same destructive-command gate as the local terminal. You cannot approve your own remote command, and you cannot connect to a host that is not configured.
fleet_list reads ~/.jewbot/fleet.json when that file exists, otherwise localhost plus every host in ~/.jewbot/hosts.json. fleet_health pings local Ollama /api/tags and runs curl -s http://127.0.0.1:11434/api/tags on each allowlisted SSH host. It ignores command, approved, and executionId. Destructive remote commands still need the owner gate, and fleet_health does not send them.
portfolio_list_gates and portfolio_next_free read .jewbot/portfolio-gates.json in the open project, or the bundled checklist when that file is missing. portfolio_next_free returns the next open gate that is not blocked by an owner or a human. portfolio_mark_gate sets one status (open, blocked, or done) in that file only. It ignores command, approved, executionId, deploy, and root. It does not deploy and it does not pause for a human gate.
music_list_releases, music_next_free, and music_mark use .jewbot/music-release.json in the open project. They do not upload, log in, or pay. An upload, login, or payment request marks the release blocked. draft:true may ask local Ollama for notes. A host argument is ignored. Notes text does not mark a release done.
Destructive commands (rm -rf, git push --force, mkfs, dd of=, chmod -R 777 /, and similar) do not run until the owner confirms in the UI. If OBSERVE says BLOCKED, the command did not run — do not claim it did.
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

    let turnContext: string;
    try {
      turnContext = await this.deps.context.buildTurnContext(goal);
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
        content: `${turnContext}\n\nGoal:\n${goal}`,
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

      let rawObservation: string;
      if (tool.name === 'run_terminal') rawObservation = yield* this.observeTerminal(tool, signal);
      else if (tool.name === 'ssh_exec') rawObservation = yield* this.observeSsh(tool, signal);
      else rawObservation = await this.dispatch(tool, signal);
      const observation = truncate(rawObservation, OBSERVATION_MAX);
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

  private async dispatch(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    try {
      switch (tool.name) {
        case 'get_project_summary': {
          const summary = await this.deps.context.getProjectSummary();
          return this.deps.context.formatForPrompt(summary);
        }
        case 'find_files': {
          const query = String(tool.args.query ?? tool.args.pattern ?? tool.args.glob ?? '');
          const limit = typeof tool.args.limit === 'number' ? tool.args.limit : undefined;
          return formatFindResult(await this.deps.context.findFiles(query, { limit }));
        }
        case 'search_files':
        case 'search_context': {
          const query = String(tool.args.query ?? tool.args.q ?? tool.args.text ?? '');
          const pathFilter = tool.args.path != null ? String(tool.args.path) : undefined;
          const limit = typeof tool.args.limit === 'number' ? tool.args.limit : undefined;
          return formatSearchResult(await this.deps.context.searchContext(query, { path: pathFilter, limit }));
        }
        case 'list_dir': {
          const rel = String(tool.args.path ?? '.');
          const entries = await this.deps.files.listDir(rel);
          return entries.length ? entries.join('\n') : '(empty directory)';
        }
        case 'read_file':
          return await this.observeRead(tool, signal);
        case 'propose_edit':
        case 'write_file':
        case 'apply_edit':
          return await this.observeEdit(tool, signal);
        case 'run_terminal':
          return 'ERROR: run_terminal did not pass the safety gate, so it was not executed.';
        case 'ssh_list_hosts':
          return this.observeSshHosts();
        case 'ssh_connect':
          return await this.observeSshConnect(tool, signal);
        case 'ssh_disconnect':
          return this.observeSshDisconnect(tool);
        case 'ssh_exec':
          return 'ERROR: ssh_exec did not pass the safety gate, so it was not executed.';
        case 'fleet_list':
          return formatFleetList(listFleet({ ssh: this.deps.ssh }));
        case 'fleet_health':
          return await this.observeFleetHealth(tool, signal);
        case 'portfolio_list_gates':
          return formatPortfolioList(portfolioListGates(this.deps.files.projectRoot));
        case 'portfolio_next_free':
          return formatPortfolioNext(portfolioNextFree(this.deps.files.projectRoot));
        case 'portfolio_mark_gate':
          return this.observePortfolioMark(tool);
        case 'music_list_releases':
          return formatMusicList(musicListReleases({ storeRoot: this.deps.files.projectRoot }));
        case 'music_next_free':
          return await this.observeMusicNext(tool, signal);
        case 'music_mark':
          return await this.observeMusicMark(tool, signal);
        case 'ask_owner':
          return String(tool.args.question ?? 'Owner input required');
        default:
          return `Unknown tool: ${tool.name}. Live tools: get_project_summary, find_files, search_context, list_dir, read_file, write_file, apply_edit, propose_edit, run_terminal, ssh_list_hosts, ssh_connect, ssh_exec, ssh_disconnect, fleet_list, fleet_health, portfolio_list_gates, portfolio_next_free, portfolio_mark_gate, music_list_releases, music_next_free, music_mark.`;
      }
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async observeRead(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    const rel = String(tool.args.path ?? '');
    try {
      return await this.deps.files.read(rel);
    } catch (err) {
      if (!(err instanceof SecretPathError)) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (signal?.aborted || !this.deps.confirmSecret) {
        return `REFUSED: secret path ${err.rel} was not opened. The owner did not confirm. Do not retry unless the owner asks.`;
      }
      const approved = await this.deps.confirmSecret({ path: err.rel, reason: err.message });
      if (!approved || signal?.aborted) {
        return `REFUSED: secret path ${err.rel} was not opened. The owner did not confirm. Do not retry unless the owner asks.`;
      }
      try {
        return await this.deps.files.read(rel, { allowSecret: true });
      } catch (inner) {
        return `ERROR: ${inner instanceof Error ? inner.message : String(inner)}`;
      }
    }
  }

  /**
   * Preview a write, ask the owner, and apply only when they accept.
   * args.confirmed, args.approved, and args.allowSecret from the model are ignored.
   */
  private async observeEdit(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    const rel = String(tool.args.path ?? '').trim();
    if (!rel) return 'ERROR: edit requires a path';
    let spec: EditSpec;
    try {
      spec = specFromArgs(tool.args);
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    let preview: DiffPreview;
    try {
      preview = await this.deps.files.previewEdit(rel, spec);
    } catch (err) {
      if (!(err instanceof SecretPathError)) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!this.deps.confirmEdit) {
        return `REFUSED: secret path ${err.rel} was not opened. Nothing was written.`;
      }
      try {
        preview = await this.deps.files.previewEdit(rel, spec, { allowSecret: true });
      } catch (inner) {
        return `ERROR: ${inner instanceof Error ? inner.message : String(inner)}`;
      }
    }

    if (preview.unchanged) {
      return `UNCHANGED: ${preview.filePath} already has the proposed contents. Nothing was written.`;
    }
    if (signal?.aborted) return 'REJECTED: cancelled before apply. Nothing was written.';

    let accepted = false;
    try {
      accepted = this.deps.confirmEdit
        ? await this.deps.confirmEdit({
            editId: preview.editId,
            path: preview.filePath,
            unifiedDiff: preview.unifiedDiff,
            created: preview.created,
            secret: preview.secret,
            tool: tool.name,
          })
        : false;
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (signal?.aborted) return 'REJECTED: cancelled before apply. Nothing was written.';
    if (!accepted) {
      const diff = preview.secret ? '' : `\n${preview.unifiedDiff}`;
      return `REJECTED: edit of ${preview.filePath} was not applied. The owner did not accept. Nothing was written.${diff}`;
    }

    try {
      await this.deps.files.applyEdit(preview, true, { allowSecret: preview.secret });
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.deps.onEditApplied?.(preview.editId, this.deps.files);
    if (preview.secret) {
      return `APPLIED: wrote secret path ${preview.filePath}. Existing contents were not included in this observation. The owner accepted the diff.`;
    }
    return `APPLIED:\n${preview.unifiedDiff}`;
  }

  /**
   * Runs `run_terminal` only after the safety gate. Yields stdout/stderr chunks
   * as they arrive, then returns the observation text for the model.
   * `args.approved` and `args.executionId` from the model are ignored.
   */
  private async *observeTerminal(
    tool: AgentToolCall,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, string, unknown> {
    const command = String(tool.args.command ?? '');
    const decision = checkShellCommand(command);
    if (!decision.ok && !decision.needsConfirmation) {
      return `ERROR: ${decision.reason}`;
    }

    let executionId: string | undefined;
    if (!decision.ok) {
      const approved = this.deps.confirmDestructive
        ? await this.deps.confirmDestructive({
            command,
            reason: decision.reason,
            category: decision.category,
          })
        : false;
      if (!approved || signal?.aborted) {
        return `BLOCKED: command was not executed. ${decision.reason} The owner did not confirm. Do not retry unless the owner asks.`;
      }
      executionId = issueConfirmation(command).executionId;
    }

    if (signal?.aborted) return 'BLOCKED: cancelled before execution.';

    const queue: AgentStreamEvent[] = [];
    let wake: (() => void) | null = null;
    let finished: TerminalResult | null = null;
    let failed: unknown = null;
    const notify = () => {
      const fn = wake;
      wake = null;
      fn?.();
    };

    const pending = this.deps.terminal
      .run(command, {
        cwd: this.deps.files.projectRoot,
        projectRoot: this.deps.files.projectRoot,
        executionId,
        signal,
        onChunk: (chunk) => {
          queue.push({ type: 'terminal_chunk', stream: chunk.stream, text: chunk.text });
          notify();
        },
      })
      .then(
        (result) => {
          finished = result;
          notify();
        },
        (err: unknown) => {
          failed = err;
          notify();
        },
      );

    while (true) {
      while (queue.length) {
        const ev = queue.shift();
        if (ev) yield ev;
      }
      if (finished || failed) break;
      await new Promise<void>((resolve) => {
        if (finished || failed || queue.length) {
          resolve();
          return;
        }
        wake = resolve;
      });
    }
    try {
      await pending;
    } catch (err) {
      failed = failed ?? err;
    }
    if (failed) {
      const message = failed instanceof Error ? failed.message : String(failed);
      return `ERROR: ${message}`;
    }
    const result = finished;
    if (!result) return 'ERROR: terminal produced no result';
    return formatTerminalObservation(result);
  }

  private async observeMusicNext(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    try {
      const next = await musicNextFree({
        storeRoot: this.deps.files.projectRoot,
        draft: tool.args.draft === true,
        signal,
        ...musicFlags(tool.args),
      });
      return formatMusicNext(next);
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async observeMusicMark(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    const status = tool.args.status;
    if (status !== 'pending' && status !== 'blocked' && status !== 'done') {
      return 'ERROR: music_mark status must be pending, blocked, or done.';
    }
    const id = typeof tool.args.id === 'string' ? tool.args.id : '';
    if (status === 'done') {
      if (signal?.aborted) return 'REFUSED: music_mark done was cancelled. Nothing was written.';
      const target = musicListReleases({ storeRoot: this.deps.files.projectRoot }).find(
        (row) => row.id === id,
      );
      if (!target) return `ERROR: Music release ${id} was not found.`;
      if (!this.deps.confirmReleaseDone) {
        return `REFUSED: music_mark done for ${target.id} needs the owner to confirm. No confirmation was given. Nothing was written. Do not retry unless the owner asks.`;
      }
      let approved = false;
      try {
        approved = await this.deps.confirmReleaseDone({
          id: target.id,
          title: target.title,
          artist: target.artist,
        });
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (signal?.aborted) return 'REFUSED: music_mark done was cancelled. Nothing was written.';
      if (!approved) {
        return `REFUSED: music_mark done for ${target.id} was not applied. The owner did not confirm. Nothing was written.`;
      }
    }
    try {
      const release = musicMark(
        {
          id,
          status,
          notes: typeof tool.args.notes === 'string' ? tool.args.notes : undefined,
          reason: typeof tool.args.reason === 'string' ? tool.args.reason : undefined,
          ...musicFlags(tool.args),
        },
        { storeRoot: this.deps.files.projectRoot },
      );
      return formatMusicRelease(release);
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async observeFleetHealth(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    const requested = typeof tool.args.host === 'string' ? tool.args.host : undefined;
    const report = await checkFleet(
      {
        ssh: this.deps.ssh,
        confirmHostKey: this.deps.confirmHostKey,
        promptSshSecret: this.deps.promptSshSecret,
        signal,
      },
      requested ? { host: requested } : undefined,
    );
    return formatFleetHealth(report);
  }

  /**
   * Status write inside the open project. Extra args (command, approved,
   * executionId, deploy, root) are ignored. This does not ask the owner.
   */
  private observePortfolioMark(tool: AgentToolCall): string {
    const id = tool.args.id;
    const status = tool.args.status;
    if (typeof id !== 'string' || typeof status !== 'string') {
      return 'ERROR: portfolio_mark_gate needs string id and status. Status is open, blocked, or done. This does not deploy.';
    }
    return formatPortfolioMark(portfolioMarkGate(id, status, this.deps.files.projectRoot));
  }

  private observeSshHosts(): string {
    const hosts = this.deps.ssh.listHosts();
    if (!hosts.length) return 'No SSH hosts are configured. The owner adds them in ~/.jewbot/hosts.json.';
    return hosts.map((host) => `${host.name} ${host.username}@${host.host}:${host.port} auth=${host.auth}`).join('\n');
  }

  private async observeSshConnect(tool: AgentToolCall, signal?: AbortSignal): Promise<string> {
    const host = sshHostArg(tool.args);
    if (!host) return 'ERROR: ssh_connect requires a host name from ssh_list_hosts';
    try {
      const info = await this.deps.ssh.connect(host, {
        confirmHostKey: this.deps.confirmHostKey,
        promptSecret: this.deps.promptSshSecret,
        signal,
      });
      return `CONNECTED ${info.name} session ${info.sessionId} ${info.username}@${info.host}:${info.port} fingerprint ${info.fingerprint}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not allowlisted|not configured/i.test(message)) {
        return `ERROR: ${message} Nothing was connected.`;
      }
      if (/denied|cancelled|not confirmed|verification failed|prompt/i.test(message)) {
        return `REFUSED: ${message} Nothing was connected.`;
      }
      return `ERROR: ${message}`;
    }
  }

  private observeSshDisconnect(tool: AgentToolCall): string {
    const host = sshHostArg(tool.args) || String(tool.args.sessionId ?? '').trim();
    if (!host) return 'ERROR: ssh_disconnect requires a host name or session id';
    return this.deps.ssh.disconnect(host) ? `DISCONNECTED ${host}` : `ERROR: no SSH session named ${host}`;
  }

  /**
   * Runs ssh_exec only after the same destructive-command gate as the local terminal.
   * args.approved and args.executionId from the model are ignored.
   */
  private async *observeSsh(
    tool: AgentToolCall,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, string, unknown> {
    const host = sshHostArg(tool.args);
    const command = String(tool.args.command ?? '');
    if (!host) return 'ERROR: ssh_exec requires a host name';
    const decision = checkShellCommand(command);
    if (!decision.ok && !decision.needsConfirmation) return `ERROR: ${decision.reason}`;

    let executionId: string | undefined;
    if (!decision.ok) {
      const approved = this.deps.confirmDestructive
        ? await this.deps.confirmDestructive({
            command,
            reason: decision.reason,
            category: decision.category,
          })
        : false;
      if (!approved || signal?.aborted) {
        return `BLOCKED: command was not executed. ${decision.reason} The owner did not confirm. Do not retry unless the owner asks.`;
      }
      executionId = issueConfirmation(command).executionId;
    }
    if (signal?.aborted) return 'BLOCKED: cancelled before execution.';

    const queue: AgentStreamEvent[] = [];
    let wake: (() => void) | null = null;
    let finished: SshExecResult | null = null;
    let failed: unknown = null;
    const notify = () => {
      const fn = wake;
      wake = null;
      fn?.();
    };

    const pending = this.deps.ssh
      .exec(host, command, {
        executionId,
        signal,
        onChunk: (chunk) => {
          queue.push({ type: 'ssh_chunk', stream: chunk.stream, text: chunk.text, host: chunk.host });
          notify();
        },
      })
      .then(
        (result) => {
          finished = result;
          notify();
        },
        (err: unknown) => {
          failed = err;
          notify();
        },
      );

    while (true) {
      while (queue.length) {
        const ev = queue.shift();
        if (ev) yield ev;
      }
      if (finished || failed) break;
      await new Promise<void>((resolve) => {
        if (finished || failed || queue.length) {
          resolve();
          return;
        }
        wake = resolve;
      });
    }
    try {
      await pending;
    } catch (err) {
      failed = failed ?? err;
    }
    if (failed) {
      const message = failed instanceof Error ? failed.message : String(failed);
      return `ERROR: ${message}`;
    }
    const result = finished;
    if (!result) return 'ERROR: SSH produced no result';
    return formatSshObservation(result);
  }
}

function sshHostArg(args: Record<string, unknown>): string {
  const value = args.host ?? args.name ?? args.target;
  return typeof value === 'string' ? value.trim() : '';
}

export function specFromArgs(args: Record<string, unknown>): EditSpec {
  const search = typeof args.search === 'string' ? args.search : typeof args.old === 'string' ? args.old : undefined;
  const replace = typeof args.replace === 'string' ? args.replace : typeof args.new === 'string' ? args.new : undefined;
  const content =
    typeof args.content === 'string' ? args.content : typeof args.contents === 'string' ? args.contents : undefined;
  if (search !== undefined && content !== undefined) {
    throw new Error('Provide either content or search/replace, not both');
  }
  if (search !== undefined) {
    if (replace === undefined) throw new Error('replace text is required when search is set');
    return { search, replace };
  }
  if (content === undefined) throw new Error('Edit needs content or search text');
  return { content };
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
