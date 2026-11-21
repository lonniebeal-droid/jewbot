export {};

interface StreamEvent {
  requestId: string;
  type: string;
  text?: string;
  name?: string;
  args?: Record<string, unknown>;
  observation?: string;
  status?: string;
  message?: string;
  finalText?: string;
  blockReason?: string;
  steps?: unknown;
  confirmId?: string;
  command?: string;
  reason?: string;
  category?: string;
  stream?: 'stdout' | 'stderr';
  editId?: string;
  path?: string;
  unifiedDiff?: string;
  created?: boolean;
  secret?: boolean;
  tool?: string;
}

interface TerminalPanelEvent {
  type: 'chunk' | 'exit';
  sessionId: string;
  stream?: 'stdout' | 'stderr';
  text?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  killed?: boolean;
  backend?: string;
}

interface TerminalStartResult {
  ok: boolean;
  started: boolean;
  sessionId?: string;
  backend?: string;
  needsConfirmation?: boolean;
  reason?: string;
  category?: string;
  pattern?: string;
  executionId?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

declare global {
  interface Window {
    jewbot: {
      status: () => Promise<{
        version?: string;
        milestone?: string;
        electron?: string;
        platform?: string;
        arch?: string;
        signing?: string;
        notarization?: string;
        projectRoot?: string;
        hosts?: Array<{ name: string; host?: string; port?: number; username?: string; auth?: string }>;
        ollama?: { host?: string; model?: string };
        ollamaOk?: boolean;
        ollamaError?: string | null;
        models?: string[];
        spendGate?: string;
        allowPaidApis?: boolean;
        cascade?: {
          runState?: string;
          error?: string | null;
          tasks?: Array<{ id: string; title: string; status: string; reason?: string; acceptance?: string }>;
        };
      }>;
      agentRun: (goal: string) => Promise<unknown>;
      startAgent: (payload: { requestId: string; goal: string }) => void;
      startChat: (payload: {
        requestId: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }) => void;
      cancelStream: (requestId: string) => void;
      onStreamEvent: (cb: (ev: StreamEvent) => void) => () => void;
      pickProjectRoot: () => Promise<{ canceled: boolean; projectRoot: string }>;
      terminalStart: (payload: { command: string; executionId?: string }) => Promise<TerminalStartResult>;
      terminalConfirm: (command: string) => Promise<TerminalStartResult>;
      terminalKill: (sessionId: string) => Promise<{ killed: boolean }>;
      terminalRun: (command: string) => Promise<unknown>;
      confirmReply: (payload: { confirmId: string; approved: boolean }) => void;
      editReply: (payload: { editId: string; accepted: boolean }) => void;
      editUndo: (editId: string) => Promise<{ ok: boolean; filePath?: string; action?: string; reason?: string }>;
      onTerminalEvent: (cb: (ev: TerminalPanelEvent) => void) => () => void;
      contextSummary: () => Promise<unknown>;
      sshList: () => Promise<{
        hosts?: Array<{ name: string; host: string; port: number; username: string; auth: string }>;
        sessions?: Array<{ name: string; sessionId: string; fingerprint?: string }>;
        error?: string | null;
      }>;
      sshConnect: (name: string) => Promise<{ ok: boolean; reason?: string; sessionId?: string; fingerprint?: string }>;
      sshDisconnect: (target: string) => Promise<{ ok: boolean }>;
      sshExec: (payload: { target: string; command: string; executionId?: string }) => Promise<{
        ok: boolean;
        started: boolean;
        execId?: string;
        sessionId?: string;
        needsConfirmation?: boolean;
        reason?: string;
        category?: string;
        executionId?: string;
      }>;
      sshConfirm: (command: string) => Promise<{ ok: boolean; executionId?: string; reason?: string }>;
      sshKill: (execId: string) => Promise<{ killed: boolean }>;
      sshHostKeyReply: (payload: { confirmId: string; approved: boolean }) => void;
      sshSecretReply: (payload: { promptId: string; secret: string | null }) => void;
      cascadeList: () => Promise<{
        runState: string;
        error: string | null;
        tasks: Array<{ id: string; title: string; status: string; reason?: string; acceptance?: string }>;
      }>;
      cascadeAdd: (payload: { title: string; prompt: string; acceptance?: string }) => Promise<{ ok: boolean; reason?: string }>;
      cascadeStart: () => Promise<{ ok?: boolean; reason?: string; runState?: string }>;
      cascadePause: () => Promise<{ runState?: string }>;
      cascadeStop: () => Promise<{ runState?: string }>;
      cascadeRequeue: (id: string) => Promise<{ ok: boolean; reason?: string }>;
      cascadeRemove: (id: string) => Promise<{ ok: boolean; reason?: string }>;
      modelsList: (host: string) => Promise<{ models: string[]; error?: string }>;
      modelsPull: (payload: { host: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
      modelsDelete: (payload: { host: string; name: string }) => Promise<{ ok: boolean; needsConfirmation?: boolean; error?: string }>;
      modelsSettings: (payload?: { models: Record<string, string> }) => Promise<{ models: Record<string, string> }>;
      expandMentions: (text: string) => Promise<{ text: string; error?: string }>;
      composerAdd: (payload: { path: string; proposed: string }) => Promise<unknown>;
      composerState: () => Promise<unknown>;
      composerDecide: (payload: { scope: 'file' | 'hunk'; path?: string; id?: string; decision: 'accept' | 'reject' }) => Promise<unknown>;
      composerApply: () => Promise<unknown>;
      composerUndo: () => Promise<unknown>;
      gitRun: (payload: { action: string; args?: string[]; executionId?: string }) => Promise<unknown>;
      gitConfirm: (payload: { action: 'push' | 'reset' | 'clean'; args?: string[] }) => Promise<unknown>;
      gitSuggest: () => Promise<{ message: string; error?: string }>;
      remoteOpen: (payload: { host: string; root: string }) => Promise<{ host: string; root: string }>;
      editorList: (rel?: string) => Promise<string[]>;
      editorOpen: (rel: string) => Promise<{
        text: string;
        dirty: boolean;
        origin: 'human' | 'agent';
        active: string | null;
        labels: string[];
      }>;
      editorEdit: (payload: { path: string; text: string }) => Promise<{
        dirty: boolean;
        label: string;
        origin: 'human' | 'agent';
        active: string | null;
        labels: string[];
      }>;
      editorInline: (payload: { path: string; fileText: string; selection: string; prompt: string }) => Promise<{
        path: string;
        original: string;
        proposed: string;
        unifiedDiff: string;
        replacement: string;
      }>;
      editorInlineAccept: (proposal: {
        path: string;
        original: string;
        proposed: string;
        unifiedDiff: string;
        replacement: string;
      }) => Promise<{ ok: boolean; path: string }>;
      editorComplete: (payload: { prefix: string; suffix: string }) => Promise<{ disabled: boolean; ghost: string }>;
      editorSave: (rel: string) => Promise<{ kind: 'clean' | 'saved' | 'review'; path: string; preview?: { unifiedDiff: string } }>;
      editorAccept: (rel: string) => Promise<{ ok: boolean; path: string }>;
      modulesList: () => Promise<
        Array<{
          id: string;
          title: string;
          description: string;
          version: string;
          capabilities: string[];
          health: 'ok' | 'down';
          detail?: string;
        }>
      >;
      onCascadeEvent: (cb: (snap: {
        runState: string;
        error: string | null;
        tasks: Array<{ id: string; title: string; status: string; reason?: string; acceptance?: string }>;
      }) => void) => () => void;
      onSshEvent: (cb: (ev: {
        type: string;
        sessionId?: string;
        execId?: string;
        stream?: 'stdout' | 'stderr';
        text?: string;
        exitCode?: number | null;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        timedOut?: boolean;
        truncated?: boolean;
        status?: string;
        name?: string;
        host?: string;
        port?: number;
        username?: string;
        fingerprint?: string;
        algorithm?: string;
        mismatch?: boolean;
        confirmId?: string;
        promptId?: string;
        kind?: string;
      }) => void) => () => void;
    };
  }
}
