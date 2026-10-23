import { app, BrowserWindow, dialog, ipcMain, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { chatStream, ChatMessage, defaultOllamaConfig, probeOllama } from '../modules/llm';
import { defaultTerminal } from '../modules/terminal';
import { defaultSshManager } from '../modules/ssh';
import { FileWorkspace } from '../modules/files';
import { ContextIndexer } from '../modules/context';
import { AgentLoop, AgentStreamEvent } from '../modules/agent';
import { CascadeRunner, M0_MILESTONE } from '../modules/cascade';
import { defaultSafetyConfig, assertLocalSpendOnly } from '../modules/safety';

let mainWindow: BrowserWindow | null = null;
let projectRoot = resolveInitialRoot();
let safety = defaultSafetyConfig(projectRoot);
let files = new FileWorkspace(projectRoot);
let context = new ContextIndexer(projectRoot);
const cascade = new CascadeRunner();
const inflight = new Map<string, AbortController>();

const CHAT_SYSTEM =
  'You are Jewbot, a local coding assistant running on Ollama. $0 spend — no paid APIs. Be concise and accurate.';

function resolveInitialRoot(): string {
  const env = process.env.JEWBOT_PROJECT_ROOT?.trim();
  if (env) {
    const abs = path.resolve(env);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
      console.warn(`JEWBOT_PROJECT_ROOT is not a directory: ${env}`);
    } catch (err) {
      console.warn(`JEWBOT_PROJECT_ROOT unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return process.cwd();
}

function setProjectRoot(next: string): string {
  const abs = path.resolve(next);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  projectRoot = abs;
  safety = defaultSafetyConfig(projectRoot);
  files = new FileWorkspace(projectRoot);
  context = new ContextIndexer(projectRoot);
  return projectRoot;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Jewbot',
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.env.JEWBOT_UI_SMOKE === '1') {
    mainWindow.webContents.on('did-finish-load', () => {
      void runUiSmoke(mainWindow!);
    });
  }
}

async function runUiSmoke(win: BrowserWindow): Promise<void> {
  try {
    const report = (await win.webContents.executeJavaScript(`
      (async () => {
        const ids = ['milestone','goal','send','stop','transcript','status','openProject','modeAgent','modeChat','projectRoot'];
        const missing = ids.filter((id) => !document.getElementById(id));
        const bridge = window.jewbot || {};
        const hasBridge = ['status','startAgent','startChat','cancelStream','onStreamEvent','pickProjectRoot'].every((k) => typeof bridge[k] === 'function');
        let status = null;
        let statusError = null;
        try { status = await window.jewbot.status(); }
        catch (e) { statusError = String(e); }
        async function sendAndWait(text, ms) {
          document.getElementById('goal').value = text;
          document.getElementById('send').click();
          const before = document.querySelectorAll('#transcript .msg, #transcript .tool').length;
          await new Promise((resolve) => {
            const deadline = Date.now() + ms;
            const timer = setInterval(() => {
              const send = document.getElementById('send');
              const grew = document.querySelectorAll('#transcript .msg, #transcript .tool').length > before;
              if ((send && send.disabled === false && grew) || Date.now() > deadline) {
                clearInterval(timer);
                resolve(null);
              }
            }, 50);
          });
        }
        await sendAndWait('__smoke__', 5000);
        const afterSmoke = document.getElementById('transcript').innerText;
        await sendAndWait('ping', 20000);
        return {
          missing,
          hasBridge,
          milestone: status && status.milestone,
          projectRoot: status && status.projectRoot,
          ollamaOk: status && status.ollamaOk,
          statusError,
          sendEnabled: document.getElementById('send').disabled === false,
          streamed: afterSmoke.includes('Hello world') && afterSmoke.includes('list_dir') && afterSmoke.includes('README.md'),
          transcript: document.getElementById('transcript').innerText.slice(0, 800),
        };
      })()
    `)) as {
      missing: string[];
      hasBridge: boolean;
      milestone?: string;
      projectRoot?: string;
      ollamaOk?: boolean;
      statusError: string | null;
      sendEnabled: boolean;
      streamed: boolean;
      transcript: string;
    };
    const ok =
      report.hasBridge &&
      report.missing.length === 0 &&
      report.milestone === 'M1' &&
      !!report.projectRoot &&
      report.sendEnabled &&
      report.streamed &&
      report.transcript.includes('ping') &&
      (report.ollamaOk || report.transcript.includes('Cannot reach Ollama'));
    console.log(`UI_SMOKE ${JSON.stringify(report)}`);
    fs.writeFileSync('/tmp/jewbot-ui-smoke.json', JSON.stringify({ ok, report }, null, 2));
    app.exit(ok ? 0 : 2);
  } catch (err) {
    console.error('UI_SMOKE_FAIL', err instanceof Error ? err.message : err);
    app.exit(3);
  }
}

function send(sender: WebContents, payload: Record<string, unknown>): void {
  if (!sender.isDestroyed()) sender.send('jewbot:streamEvent', payload);
}

function track(requestId: string): AbortController {
  const prev = inflight.get(requestId);
  if (prev) prev.abort();
  const ctrl = new AbortController();
  inflight.set(requestId, ctrl);
  return ctrl;
}

function finish(requestId: string): void {
  inflight.delete(requestId);
}

app.whenReady().then(() => {
  createWindow();
  cascade.enqueue({
    ...M0_MILESTONE,
    status: 'pending',
    run: async () => ({ status: 'done', detail: M0_MILESTONE.detail }),
  });

  ipcMain.handle('jewbot:status', async () => {
    const cfg = defaultOllamaConfig();
    const spend = assertLocalSpendOnly(safety.allowPaidApis);
    const probe = await probeOllama(cfg);
    return {
      version: app.getVersion(),
      milestone: 'M1',
      projectRoot,
      allowPaidApis: safety.allowPaidApis,
      spendGate: spend.ok ? 'local-only' : 'paid-blocked',
      ollama: { host: cfg.host, model: cfg.model, allowPaidApis: cfg.allowPaidApis },
      ollamaOk: probe.ok,
      ollamaError: probe.error ?? null,
      models: probe.models,
      hosts: defaultSshManager.listHosts(),
      cascade: cascade.list().map((m) => ({ id: m.id, title: m.title, status: m.status })),
    };
  });

  ipcMain.handle('jewbot:pickProjectRoot', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const dialogOpts = {
      title: 'Open project folder',
      properties: ['openDirectory'] as 'openDirectory'[],
    };
    const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, projectRoot };
    }
    const next = setProjectRoot(result.filePaths[0]);
    return { canceled: false, projectRoot: next };
  });

  ipcMain.handle('jewbot:agentRun', async (_e, goal: string) => {
    const agent = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
    });
    return agent.run(String(goal ?? ''));
  });

  ipcMain.on('jewbot:agentStart', async (event, payload: unknown) => {
    const req = asAgentStart(payload);
    if (!req) {
      const requestId =
        payload && typeof payload === 'object' && typeof (payload as { requestId?: unknown }).requestId === 'string'
          ? (payload as { requestId: string }).requestId
          : 'bad';
      send(event.sender, { requestId, type: 'error', message: 'Invalid agent request' });
      send(event.sender, { requestId, type: 'done', status: 'blocked' });
      return;
    }
    if (process.env.JEWBOT_UI_SMOKE === '1' && req.goal === '__smoke__') {
      const fake: AgentStreamEvent[] = [
        { type: 'status', status: 'planning' },
        { type: 'token', text: 'Hello' },
        { type: 'token', text: ' world' },
        { type: 'message_done', text: 'Hello world' },
        { type: 'tool_call', name: 'list_dir', args: { path: '.' } },
        { type: 'tool_result', name: 'list_dir', args: { path: '.' }, observation: 'README.md' },
        { type: 'final', text: 'Hello world' },
        { type: 'done', result: { status: 'done', steps: [], finalText: 'Hello world' } },
      ];
      for (const ev of fake) send(event.sender, toIpcEvent(req.requestId, ev));
      return;
    }
    const ctrl = track(req.requestId);
    const agent = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
    });
    try {
      for await (const ev of agent.runStream(req.goal, ctrl.signal)) {
        send(event.sender, toIpcEvent(req.requestId, ev));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(event.sender, { requestId: req.requestId, type: 'error', message });
      send(event.sender, { requestId: req.requestId, type: 'done', status: 'blocked', blockReason: message });
    } finally {
      finish(req.requestId);
    }
  });

  ipcMain.on('jewbot:chatStart', async (event, payload: unknown) => {
    const req = asChatStart(payload);
    if (!req) {
      const requestId =
        payload && typeof payload === 'object' && typeof (payload as { requestId?: unknown }).requestId === 'string'
          ? (payload as { requestId: string }).requestId
          : 'bad';
      send(event.sender, { requestId, type: 'error', message: 'Invalid chat request' });
      send(event.sender, { requestId, type: 'done', status: 'blocked' });
      return;
    }
    const ctrl = track(req.requestId);
    const messages: ChatMessage[] = [{ role: 'system', content: CHAT_SYSTEM }, ...req.messages];
    try {
      let text = '';
      for await (const token of chatStream(messages, defaultOllamaConfig(), { signal: ctrl.signal })) {
        text += token;
        send(event.sender, { requestId: req.requestId, type: 'token', text: token });
      }
      send(event.sender, { requestId: req.requestId, type: 'message_done', text });
      send(event.sender, { requestId: req.requestId, type: 'done', status: 'done', finalText: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(event.sender, { requestId: req.requestId, type: 'error', message });
      send(event.sender, { requestId: req.requestId, type: 'done', status: 'blocked', blockReason: message });
    } finally {
      finish(req.requestId);
    }
  });

  ipcMain.on('jewbot:streamCancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return;
    inflight.get(requestId)?.abort();
  });

  ipcMain.handle('jewbot:terminalRun', async (_e, command: string, approved?: boolean, executionId?: string) => {
    return defaultTerminal.run(command, {
      cwd: projectRoot,
      approved,
      executionId,
      requireApproval: Boolean(approved) === false ? false : safety.requireShellApproval,
    });
  });

  ipcMain.handle('jewbot:contextSummary', async () => context.summarize());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const ctrl of inflight.values()) ctrl.abort();
  inflight.clear();
  if (process.platform !== 'darwin') app.quit();
});

function toIpcEvent(requestId: string, ev: AgentStreamEvent): Record<string, unknown> {
  if (ev.type === 'done') {
    return {
      requestId,
      type: 'done',
      status: ev.result.status,
      finalText: ev.result.finalText,
      blockReason: ev.result.blockReason,
      steps: ev.result.steps.map((s) => ({
        n: s.n,
        tool: s.tool,
        observation: s.observation,
      })),
    };
  }
  return { requestId, ...ev };
}

function asAgentStart(v: unknown): { requestId: string; goal: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.requestId !== 'string' || !o.requestId || o.requestId.length > 80) return null;
  if (typeof o.goal !== 'string' || !o.goal.trim() || o.goal.length > 20_000) return null;
  return { requestId: o.requestId, goal: o.goal };
}

function asChatStart(v: unknown): { requestId: string; messages: ChatMessage[] } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.requestId !== 'string' || !o.requestId || o.requestId.length > 80) return null;
  if (!Array.isArray(o.messages) || o.messages.length > 40) return null;
  const messages: ChatMessage[] = [];
  for (const item of o.messages) {
    if (!item || typeof item !== 'object') return null;
    const m = item as Record<string, unknown>;
    if (m.role !== 'user' && m.role !== 'assistant') return null;
    if (typeof m.content !== 'string' || m.content.length > 32_000) return null;
    messages.push({ role: m.role, content: m.content });
  }
  if (!messages.length) return null;
  return { requestId: o.requestId, messages };
}
