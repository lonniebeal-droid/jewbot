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
        ollama?: { host?: string; model?: string };
        ollamaOk?: boolean;
        ollamaError?: string | null;
        models?: string[];
        spendGate?: string;
        allowPaidApis?: boolean;
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
    };
  }
}
