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
        milestone?: string;
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
