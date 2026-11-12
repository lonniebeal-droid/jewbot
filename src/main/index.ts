import { randomUUID } from 'crypto';
import { app, BrowserWindow, dialog, ipcMain, WebContents } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chatStream, ChatMessage, defaultOllamaConfig, probeOllama } from '../modules/llm';
import { defaultTerminal, TerminalStartResult } from '../modules/terminal';
import {
  createScriptedClientFactory,
  defaultSshManager,
  HostKeyPrompt,
  SecretPrompt,
  SshExecChunk,
  SshExecResult,
  SshSessionInfo,
  SshStartResult,
} from '../modules/ssh';
import { FileWorkspace } from '../modules/files';
import { ContextIndexer } from '../modules/context';
import { AgentLoop, AgentStreamEvent, DestructiveConfirmRequest, EditConfirmRequest } from '../modules/agent';
import { CascadeAgentOutcome, CascadeRunner, CascadeTask } from '../modules/cascade';
import { assertLocalSpendOnly, defaultSafetyConfig, issueConfirmation, SafetyDecision } from '../modules/safety';
import { bootModules, listModuleHealth, shutdownModules } from '../modules/plugin';

let mainWindow: BrowserWindow | null = null;
let projectRoot = resolveInitialRoot();
let safety = defaultSafetyConfig(projectRoot);
let files = new FileWorkspace(projectRoot);
let context = new ContextIndexer(projectRoot);
const cascadeStoreRoot =
  process.env.JEWBOT_UI_SMOKE === '1' ? fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m6-ui-')) : projectRoot;
const cascade = new CascadeRunner({
  projectRoot,
  storeRoot: cascadeStoreRoot,
  files,
  terminal: defaultTerminal,
  ssh: defaultSshManager,
  context,
  execute: process.env.JEWBOT_UI_SMOKE === '1' ? smokeCascadeExecute : undefined,
});
const inflight = new Map<string, AbortController>();
const pendingConfirms = new Map<string, (approved: boolean) => void>();
const pendingEdits = new Map<string, (accepted: boolean) => void>();
const pendingHostKeys = new Map<string, (approved: boolean) => void>();
const pendingSecrets = new Map<string, (secret: string | null) => void>();
const undoTargets = new Map<string, FileWorkspace>();
let uiSshExecs: string[] = [];
let uiSshPassOk = false;
let uiSshKnownPath = '';

const CHAT_SYSTEM =
  'You are Jewbot, a local coding assistant running on Ollama. $0 spend — no paid APIs. Be concise and accurate. The project snapshot below is a compact tree plus a few excerpts, not the whole repo. Secret files are omitted.';

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
  cascade.setWorkspace({ projectRoot, files, context });
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
    title: `Jewbot ${app.getVersion()}`,
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.env.JEWBOT_LAUNCH_SMOKE === '1' && process.env.JEWBOT_UI_SMOKE !== '1') {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.error('JEWBOT_LAUNCH_FAIL timeout waiting for the window');
      app.exit(1);
    }, 30000);
    mainWindow.webContents.on('did-finish-load', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.log(`JEWBOT_LAUNCH_OK ${app.getVersion()} ${process.platform} ${process.arch}`);
      app.exit(0);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || finished) return;
      finished = true;
      clearTimeout(timer);
      console.error(`JEWBOT_LAUNCH_FAIL ${code} ${description}`);
      app.exit(1);
    });
  }

  if (process.env.JEWBOT_UI_SMOKE === '1') {
    mainWindow.webContents.on('did-finish-load', () => {
      void runUiSmoke(mainWindow!);
    });
  }
}

function editSmokeFilesOk(): boolean {
  try {
    const raw = fs.readFileSync('/tmp/jewbot-m3-ui-edit.jsonl', 'utf8').trim();
    const rows = raw.split('\n').map(
      (line) => JSON.parse(line) as { goal: string; accepted: boolean; body: string; tmp: string },
    );
    const reject = rows.find((row) => row.goal === 'reject');
    const accept = rows.find((row) => row.goal === 'accept');
    if (!reject || !accept) return false;
    if (reject.accepted !== false || reject.body !== 'old\n') return false;
    if (accept.accepted !== true || accept.body !== 'hello from m3\n') return false;
    return fs.readFileSync(path.join(accept.tmp, 'note.txt'), 'utf8') === 'old\n';
  } catch {
    return false;
  }
}

async function runUiSmoke(win: BrowserWindow): Promise<void> {
  try {
    try {
      fs.unlinkSync('/tmp/jewbot-m3-ui-edit.jsonl');
    } catch {
      // no previous edit smoke receipt
    }
    const report = (await win.webContents.executeJavaScript(`
      (async () => {
        const ids = ['milestone','version','aboutOpen','aboutModal','aboutBody','aboutClose','goal','send','stop','transcript','status','openProject','modeAgent','modeChat','projectRoot','termCommand','termRun','termKill','termOut','confirmModal','confirmYes','confirmNo','confirmCommand','confirmBlurb','sshHost','sshConnect','sshDisconnect','sshHosts','sshSessions','sshOut','sshCommand','sshRun','sshKill','sshState','sshHostModal','sshHostYes','sshHostNo','sshHostFingerprint','sshSecretModal','sshSecretInput','sshSecretOk','cascadeList','cascadeState','cascadeStart','cascadePause','cascadeStop','cascadeTitle','cascadePrompt','cascadeAccept','cascadeAdd','modulesList','modulesState'];
        const missing = ids.filter((id) => !document.getElementById(id));
        const bridge = window.jewbot || {};
        const hasBridge = ['status','startAgent','startChat','cancelStream','onStreamEvent','pickProjectRoot','terminalStart','terminalConfirm','terminalKill','confirmReply','onTerminalEvent','editReply','editUndo','sshList','sshConnect','sshDisconnect','sshExec','sshConfirm','sshKill','sshHostKeyReply','sshSecretReply','onSshEvent','cascadeList','cascadeAdd','cascadeStart','cascadePause','cascadeStop','cascadeRequeue','cascadeRemove','onCascadeEvent','modulesList'].every((k) => typeof bridge[k] === 'function');
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
        async function runEditSmoke(goal, accept) {
          document.getElementById('goal').value = goal;
          document.getElementById('send').click();
          const before = document.querySelectorAll('.diff-card').length;
          const shown = await waitFor(() => document.querySelectorAll('.diff-card').length > before, 5000);
          const cards = document.querySelectorAll('.diff-card');
          const card = cards[cards.length - 1];
          const diffText = card ? card.innerText : '';
          const button = card ? card.querySelector(accept ? '.diff-accept' : '.diff-reject') : null;
          if (button) button.click();
          const marked = await waitFor(() => {
            const status = card && card.querySelector('.diff-status');
            const text = status ? status.textContent : '';
            return accept ? text.indexOf('Applied') >= 0 : text.indexOf('Rejected') >= 0;
          }, 5000);
          let undone = false;
          if (accept && card) {
            const undo = card.querySelector('.diff-undo');
            if (undo) undo.click();
            undone = await waitFor(() => {
              const status = card.querySelector('.diff-status');
              return !!(status && status.textContent.indexOf('Undone') >= 0);
            }, 4000);
          }
          const idle = await waitFor(() => document.getElementById('send').disabled === false, 4000);
          return { shown, diffText, marked, undone, idle };
        }
        const editReject = await runEditSmoke('__smoke_edit_reject__', false);
        const editAccept = await runEditSmoke('__smoke_edit__', true);
        await sendAndWait('ping', 20000);
        async function waitFor(pred, ms) {
          const deadline = Date.now() + ms;
          while (Date.now() < deadline) {
            if (pred()) return true;
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
          return pred();
        }
        document.getElementById('termCommand').value = 'echo jewbot-ui-m2';
        document.getElementById('termRun').click();
        const echoShown = await waitFor(() => document.getElementById('termOut').innerText.includes('jewbot-ui-m2'), 8000);
        const echoDone = await waitFor(() => document.getElementById('termState').textContent !== 'running', 4000);
        const echoState = document.getElementById('termState').textContent;
        document.getElementById('termCommand').value = 'rm -rf /tmp/jewbot-ui-m2-nope';
        document.getElementById('termRun').click();
        const dialogShown = await waitFor(() => document.getElementById('confirmModal').hidden === false, 4000);
        const dialogCommand = document.getElementById('confirmCommand').textContent;
        document.getElementById('confirmNo').click();
        const cancelNoted = await waitFor(() => document.getElementById('termOut').innerText.includes('not run'), 2000);
        const dialogClosed = document.getElementById('confirmModal').hidden === true;
        const termAfterCancel = document.getElementById('termOut').innerText;
        const blocked = await window.jewbot.terminalStart({ command: 'rm -rf /tmp/jewbot-ui-m2-nope' });
        document.getElementById('refresh').click();
        const sshHasPi = await waitFor(() => document.getElementById('sshHosts').innerText.indexOf('pi') >= 0, 4000);
        const modulesReady = await waitFor(() => {
          const row = document.querySelector('#modulesList [data-module="muse"]');
          const echo = document.querySelector('#modulesList [data-module="echo"]');
          const health = row && row.dataset.health;
          return !!(row && echo && (health === 'ok' || health === 'down'));
        }, 8000);
        const moduleCount = document.querySelectorAll('#modulesList [data-module]').length;
        document.getElementById('sshHost').value = 'pi';
        document.getElementById('sshConnect').click();
        const sshSecretShown = await waitFor(() => document.getElementById('sshSecretModal').hidden === false, 4000);
        document.getElementById('sshSecretInput').value = 'ui-pass-phrase-99';
        document.getElementById('sshSecretOk').click();
        const sshHostShown = await waitFor(() => document.getElementById('sshHostModal').hidden === false, 4000);
        const sshFingerprint = document.getElementById('sshHostFingerprint').textContent || '';
        document.getElementById('sshHostYes').click();
        const sshConnected = await waitFor(() => document.getElementById('sshState').textContent === 'connected', 4000);
        document.getElementById('sshCommand').value = 'echo jewbot-ssh-ui';
        document.getElementById('sshRun').click();
        const sshEcho = await waitFor(() => document.getElementById('sshOut').innerText.indexOf('jewbot-ssh-ui') >= 0, 4000);
        const sshEchoDone = await waitFor(() => document.getElementById('sshState').textContent === 'connected', 4000);
        document.getElementById('sshCommand').value = 'rm -rf /tmp/jewbot-ssh-ui-nope';
        document.getElementById('sshRun').click();
        const sshDialog = await waitFor(() => document.getElementById('confirmModal').hidden === false, 4000);
        const sshDialogCommand = document.getElementById('confirmCommand').textContent || '';
        document.getElementById('confirmNo').click();
        const sshCancel = await waitFor(() => document.getElementById('sshOut').innerText.indexOf('not run') >= 0, 2000);
        const sshSecretCleared = document.getElementById('sshSecretInput').value === ''
          && document.getElementById('sshOut').innerText.indexOf('ui-pass-phrase-99') < 0;
        async function addCascade(title, prompt) {
          document.getElementById('cascadeTitle').value = title;
          document.getElementById('cascadePrompt').value = prompt;
          document.getElementById('cascadeAccept').value = '';
          document.getElementById('cascadeAdd').click();
          return waitFor(() => {
            const row = document.querySelector('#cascadeList [data-task="' + title + '"]');
            return !!(row && row.dataset.status === 'pending');
          }, 4000);
        }
        function cascadeRow(title) {
          return document.querySelector('#cascadeList [data-task="' + title + '"]');
        }
        const cascadeAddedWait = await addCascade('Wait task', '__cascade_wait__');
        document.getElementById('cascadeStart').click();
        const cascadeSawRunning = await waitFor(() => document.getElementById('cascadeState').textContent === 'running', 4000);
        document.getElementById('cascadeStop').click();
        const cascadeStopped = await waitFor(() => {
          const row = cascadeRow('Wait task');
          return !!(row && row.dataset.status === 'blocked' && (row.dataset.reason || '').indexOf('Stopped') >= 0
            && document.getElementById('cascadeState').textContent === 'idle');
        }, 4000);
        const cascadeAdded = [
          await addCascade('First task', 'say hello'),
          await addCascade('Blocked task', '__cascade_block__'),
          await addCascade('Third task', 'say next'),
        ];
        document.getElementById('cascadeStart').click();
        const cascadeAdvanced = await waitFor(() => {
          const first = cascadeRow('First task');
          const blocked = cascadeRow('Blocked task');
          const third = cascadeRow('Third task');
          return !!(first && first.dataset.status === 'done'
            && blocked && blocked.dataset.status === 'blocked' && (blocked.dataset.reason || '').indexOf('confirmation') >= 0
            && third && third.dataset.status === 'done'
            && document.getElementById('cascadeState').textContent === 'idle');
        }, 5000);
        return {
          missing,
          hasBridge,
          milestone: status && status.milestone,
          version: status && status.version,
          aboutText: document.getElementById('aboutBody').textContent,
          projectRoot: status && status.projectRoot,
          ollamaOk: status && status.ollamaOk,
          statusError,
          sendEnabled: document.getElementById('send').disabled === false,
          streamed: afterSmoke.includes('Hello world') && afterSmoke.includes('list_dir') && afterSmoke.includes('README.md'),
          transcript: document.getElementById('transcript').innerText.slice(0, 800),
          echoShown,
          echoDone,
          echoState,
          dialogShown,
          dialogCommand,
          dialogClosed,
          cancelNoted,
          blockedStarted: !!(blocked && blocked.started),
          blockedNeedsConfirm: !!(blocked && blocked.needsConfirmation),
          termOut: termAfterCancel.slice(0, 500),
          editRejectShown: !!(editReject && editReject.shown && editReject.diffText.indexOf('hello from m3') >= 0 && editReject.diffText.indexOf('old') >= 0),
          editRejectMarked: !!(editReject && editReject.marked && editReject.idle),
          editAcceptShown: !!(editAccept && editAccept.shown && editAccept.diffText.indexOf('hello from m3') >= 0),
          editAcceptMarked: !!(editAccept && editAccept.marked),
          editAcceptUndone: !!(editAccept && editAccept.undone),
          sshHasPi,
          sshSecretShown,
          sshHostShown,
          sshFingerprint,
          sshConnected,
          sshEcho,
          sshEchoDone,
          sshDialog,
          sshDialogCommand,
          sshCancel,
          sshSecretCleared,
          cascadeAddedWait,
          cascadeSawRunning,
          cascadeStopped,
          cascadeAdded: cascadeAdded.every(Boolean),
          cascadeAdvanced,
          modulesReady,
          moduleCount,
        };
      })()
    `)) as {
      missing: string[];
      hasBridge: boolean;
      milestone?: string;
      version?: string;
      aboutText?: string;
      projectRoot?: string;
      ollamaOk?: boolean;
      statusError: string | null;
      sendEnabled: boolean;
      streamed: boolean;
      transcript: string;
      echoShown: boolean;
      echoDone: boolean;
      echoState: string;
      dialogShown: boolean;
      dialogCommand: string;
      dialogClosed: boolean;
      cancelNoted: boolean;
      blockedStarted: boolean;
      blockedNeedsConfirm: boolean;
      termOut: string;
      editRejectShown: boolean;
      editRejectMarked: boolean;
      editAcceptShown: boolean;
      editAcceptMarked: boolean;
      editAcceptUndone: boolean;
      sshHasPi: boolean;
      sshSecretShown: boolean;
      sshHostShown: boolean;
      sshFingerprint: string;
      sshConnected: boolean;
      sshEcho: boolean;
      sshEchoDone: boolean;
      sshDialog: boolean;
      sshDialogCommand: string;
      sshCancel: boolean;
      sshSecretCleared: boolean;
      cascadeAddedWait: boolean;
      cascadeSawRunning: boolean;
      cascadeStopped: boolean;
      cascadeAdded: boolean;
      cascadeAdvanced: boolean;
      modulesReady: boolean;
      moduleCount: number;
    };
    let knownBody = '';
    try {
      knownBody = fs.readFileSync(uiSshKnownPath, 'utf8');
    } catch {
      knownBody = '';
    }
    const sshKnownSafe = knownBody.includes('SHA256:') && !knownBody.includes('ui-pass-phrase-99');
    const sshEchoRan = uiSshExecs.some((command) => command.includes('jewbot-ssh-ui'));
    const sshRmBlocked = !uiSshExecs.some((command) => command.includes('rm'));
    const ok =
      report.hasBridge &&
      report.missing.length === 0 &&
      report.milestone === 'M7' &&
      report.version === '0.1.0' &&
      (report.aboutText || '').includes('0.1.0') &&
      (report.aboutText || '').includes('unsigned') &&
      !!report.projectRoot &&
      report.sendEnabled &&
      report.streamed &&
      report.transcript.includes('ping') &&
      report.echoShown &&
      report.echoDone &&
      report.dialogShown &&
      report.dialogCommand.includes('rm -rf') &&
      report.dialogClosed &&
      report.cancelNoted &&
      report.blockedStarted === false &&
      report.blockedNeedsConfirm === true &&
      report.editRejectShown &&
      report.editRejectMarked &&
      report.editAcceptShown &&
      report.editAcceptMarked &&
      report.editAcceptUndone &&
      report.sshHasPi &&
      report.sshSecretShown &&
      report.sshHostShown &&
      report.sshFingerprint.startsWith('SHA256:') &&
      report.sshConnected &&
      report.sshEcho &&
      report.sshEchoDone &&
      report.sshDialog &&
      report.sshDialogCommand.includes('rm -rf') &&
      report.sshCancel &&
      report.sshSecretCleared &&
      uiSshPassOk &&
      sshKnownSafe &&
      sshEchoRan &&
      sshRmBlocked &&
      report.cascadeAddedWait &&
      report.cascadeSawRunning &&
      report.cascadeStopped &&
      report.cascadeAdded &&
      report.cascadeAdvanced &&
      report.modulesReady &&
      report.moduleCount >= 15 &&
      editSmokeFilesOk() &&
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

function sshCryptoLine(): string {
  try {
    require('ssh2/lib/protocol/crypto/build/Release/sshcrypto.node');
    return 'sshcrypto: loaded';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Cannot find module')) {
      return 'sshcrypto: js-fallback';
    }
    return `sshcrypto: FAIL ${message}`;
  }
}

function nativeModuleLine(label: string, load: () => void): string {
  try {
    load();
    return `${label}: loaded`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${label}: FAIL ${message}`;
  }
}

app.whenReady().then(async () => {
  if (process.argv.includes('--jewbot-version')) {
    const lines = [
      `jewbot ${app.getVersion()}`,
      'milestone M7',
      `electron ${process.versions.electron}`,
      `platform ${process.platform} ${process.arch}`,
      'signing off',
      'notarization off',
      nativeModuleLine('node-pty', () => {
        require('node-pty');
      }),
      nativeModuleLine('cpu-features', () => {
        require('cpu-features');
      }),
      sshCryptoLine(),
    ];
    console.log(lines.join('\n'));
    app.exit(lines.some((line) => line.includes(': FAIL')) ? 1 : 0);
    return;
  }

  if (process.env.JEWBOT_UI_SMOKE === '1') prepareUiSmokeSsh();
  try {
    await bootModules();
  } catch (err) {
    console.warn(`module boot: ${err instanceof Error ? err.message : String(err)}`);
  }
  bindSshEvents();
  bindCascadeEvents();
  createWindow();

  ipcMain.handle('jewbot:modules', async () => listModuleHealth());

  ipcMain.handle('jewbot:status', async () => {
    const cfg = defaultOllamaConfig();
    const spend = assertLocalSpendOnly(safety.allowPaidApis);
    const probe = await probeOllama(cfg);
    return {
      version: app.getVersion(),
      milestone: 'M7',
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      signing: 'off',
      notarization: 'off',
      cascade: cascade.snapshot(),
      projectRoot,
      allowPaidApis: safety.allowPaidApis,
      spendGate: spend.ok ? 'local-only' : 'paid-blocked',
      ollama: { host: cfg.host, model: cfg.model, allowPaidApis: cfg.allowPaidApis },
      ollamaOk: probe.ok,
      ollamaError: probe.error ?? null,
      models: probe.models,
      hosts: defaultSshManager.listHosts(),
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
      // One-shot run has no renderer request to round-trip a confirmation
      // through, so ask the owner directly with a native dialog. Cancel is
      // the default: without an explicit "Mark done" nothing is written.
      confirmReleaseDone: async (releaseReq) => {
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
        const box = {
          type: 'question' as const,
          buttons: ['Mark done', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Mark release done?',
          message: `Mark "${releaseReq.title}" by ${releaseReq.artist} done?`,
          detail:
            'This only records completion after your distributor/store steps. It does not upload, log in, or pay.',
        };
        const result = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
        return result.response === 0;
      },
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
    if (process.env.JEWBOT_UI_SMOKE === '1' && (req.goal === '__smoke_edit__' || req.goal === '__smoke_edit_reject__')) {
      try {
        await runUiEditSmoke(event.sender, req.requestId, req.goal === '__smoke_edit__');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(event.sender, { requestId: req.requestId, type: 'error', message });
        send(event.sender, { requestId: req.requestId, type: 'done', status: 'blocked', blockReason: message });
      }
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
      confirmDestructive: (confirmReq) =>
        requestOwnerConfirm(event.sender, req.requestId, confirmReq, ctrl.signal),
      confirmHostKey: (hostReq) => requestHostKey(event.sender, hostReq, ctrl.signal),
      promptSshSecret: (secretReq) => requestSecret(event.sender, secretReq, ctrl.signal),
      confirmEdit: (editReq) => requestEditDecision(event.sender, req.requestId, editReq, ctrl.signal),
      confirmSecret: (secretReq) =>
        requestOwnerConfirm(
          event.sender,
          req.requestId,
          { command: secretReq.path, reason: secretReq.reason, category: 'secret_path' },
          ctrl.signal,
        ),
      // The music done-gate: without this callback every music_mark done is
      // refused in the desktop app, even when the owner explicitly asks for
      // it. Route it through the same owner-confirm flow as destructive
      // commands; the renderer shows a release-specific prompt for this
      // category instead of the destructive-command wording.
      confirmReleaseDone: (releaseReq) =>
        requestOwnerConfirm(
          event.sender,
          req.requestId,
          {
            command: `music_mark done ${releaseReq.id}`,
            reason: `Mark "${releaseReq.title}" by ${releaseReq.artist} done? This only records completion after your distributor/store steps. It does not upload, log in, or pay.`,
            category: 'music_release_done',
          },
          ctrl.signal,
        ),
      onEditApplied: (editId, workspace) => {
        undoTargets.set(editId, workspace);
      },
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
    let system = CHAT_SYSTEM;
    try {
      const lastUser = [...req.messages].reverse().find((message) => message.role === 'user');
      const snapshot = await context.buildTurnContext(lastUser?.content ?? '');
      if (snapshot.trim()) system = `${CHAT_SYSTEM}\n\n${snapshot}`;
    } catch (err) {
      console.warn(`context index skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...req.messages];
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

  ipcMain.on('jewbot:confirmReply', (_event, payload: unknown) => {
    const reply = asConfirmReply(payload);
    if (!reply) return;
    const finish = pendingConfirms.get(reply.confirmId);
    if (!finish) return;
    finish(reply.approved);
  });

  ipcMain.on('jewbot:editReply', (_event, payload: unknown) => {
    const reply = asEditReply(payload);
    if (!reply) return;
    const finish = pendingEdits.get(reply.editId);
    if (!finish) return;
    finish(reply.accepted);
  });

  ipcMain.handle('jewbot:editUndo', async (_event, editId: unknown) => {
    if (typeof editId !== 'string' || !editId || editId.length > 80) return { ok: false, reason: 'Invalid edit' };
    const ws = undoTargets.get(editId) ?? files;
    try {
      const result = await ws.undoEdit(editId);
      return { ok: true, filePath: result.filePath, action: result.action };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('jewbot:terminalStart', async (event, payload: unknown) => {
    const req = asTerminalStart(payload);
    if (!req) return { ok: false, started: false, needsConfirmation: false, reason: 'Invalid terminal request' } satisfies TerminalStartResult;
    const prepared = defaultTerminal.prepare(req.command);
    if (!prepared.ok && !prepared.needsConfirmation) return prepared;
    if (!prepared.ok && prepared.needsConfirmation && !req.executionId) return prepared;
    try {
      const started = defaultTerminal.start(req.command, {
        cwd: projectRoot,
        projectRoot,
        executionId: req.executionId,
        onChunk: (chunk) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('jewbot:terminalEvent', {
            type: 'chunk',
            sessionId: chunk.sessionId,
            stream: chunk.stream,
            text: chunk.text,
          });
        },
      });
      void started.done.then(
        (result) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('jewbot:terminalEvent', {
            type: 'exit',
            sessionId: result.sessionId,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            truncated: result.truncated,
            killed: result.killed,
            backend: result.backend,
          });
        },
        (err: unknown) => {
          if (event.sender.isDestroyed()) return;
          event.sender.send('jewbot:terminalEvent', {
            type: 'exit',
            sessionId: started.sessionId,
            exitCode: null,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            timedOut: false,
            truncated: false,
            killed: false,
            backend: started.backend,
          });
        },
      );
      return {
        ok: true,
        started: true,
        sessionId: started.sessionId,
        backend: started.backend,
      } satisfies TerminalStartResult;
    } catch (err) {
      const decision = (err as Error & { decision?: SafetyDecision }).decision;
      if (decision && !decision.ok) {
        return {
          ok: false,
          started: false,
          needsConfirmation: decision.needsConfirmation,
          reason: decision.reason,
          category: decision.category,
          pattern: decision.pattern,
        } satisfies TerminalStartResult;
      }
      return {
        ok: false,
        started: false,
        needsConfirmation: false,
        reason: err instanceof Error ? err.message : String(err),
      } satisfies TerminalStartResult;
    }
  });

  ipcMain.handle('jewbot:terminalConfirm', async (_event, command: unknown) => {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000) {
      return { ok: false, reason: 'Invalid command' };
    }
    const prepared = defaultTerminal.prepare(command);
    if (prepared.ok) return { ok: true, needsConfirmation: false };
    if (!prepared.needsConfirmation) return { ok: false, reason: prepared.reason, category: prepared.category };
    const { executionId } = issueConfirmation(command);
    return {
      ok: true,
      needsConfirmation: true,
      executionId,
      reason: prepared.reason,
      category: prepared.category,
      pattern: prepared.pattern,
    };
  });

  ipcMain.handle('jewbot:terminalKill', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) return { killed: false };
    return { killed: defaultTerminal.kill(sessionId) };
  });

  ipcMain.handle('jewbot:terminalRun', async (_event, command: unknown) => {
    if (typeof command !== 'string') return { ok: false, started: false, reason: 'Invalid command' };
    const prepared = defaultTerminal.prepare(command);
    if (!prepared.ok) return { ...prepared, exitCode: null, stdout: '', stderr: '' };
    return defaultTerminal.run(command, { cwd: projectRoot, projectRoot });
  });

  ipcMain.handle('jewbot:contextSummary', async () => context.summarize());

  ipcMain.handle('jewbot:cascadeList', async () => cascade.snapshot());

  ipcMain.handle('jewbot:cascadeAdd', async (_event, payload: unknown) => {
    const req = asCascadeAdd(payload);
    if (!req) return { ok: false, reason: 'Invalid cascade task' };
    try {
      return { ok: true, task: cascade.enqueue(req) };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('jewbot:cascadeStart', async () => {
    try {
      await cascade.start();
      return { ok: true, ...cascade.snapshot() };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err), ...cascade.snapshot() };
    }
  });

  ipcMain.handle('jewbot:cascadePause', async () => {
    cascade.pause();
    return cascade.snapshot();
  });

  ipcMain.handle('jewbot:cascadeStop', async () => {
    cascade.stop();
    return cascade.snapshot();
  });

  ipcMain.handle('jewbot:cascadeRequeue', async (_event, id: unknown) => {
    if (typeof id !== 'string') return { ok: false, reason: 'Invalid task' };
    const task = cascade.requeue(id);
    return task ? { ok: true, task } : { ok: false, reason: 'Task cannot be requeued' };
  });

  ipcMain.handle('jewbot:cascadeRemove', async (_event, id: unknown) => {
    if (typeof id !== 'string') return { ok: false, reason: 'Invalid task' };
    const ok = cascade.remove(id);
    return ok ? { ok: true } : { ok: false, reason: 'Task cannot be removed' };
  });

  ipcMain.handle('jewbot:sshList', async () => defaultSshManager.inventory());

  ipcMain.handle('jewbot:sshConnect', async (event, name: unknown) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 64) return { ok: false, reason: 'Invalid host' };
    try {
      const info = await defaultSshManager.connect(name.trim(), {
        confirmHostKey: (hostReq) => requestHostKey(event.sender, hostReq),
        promptSecret: (secretReq) => requestSecret(event.sender, secretReq),
      });
      return { ok: true, ...info };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'SSH connect failed' };
    }
  });

  ipcMain.handle('jewbot:sshDisconnect', async (_event, target: unknown) => {
    if (typeof target !== 'string' || !target || target.length > 80) return { ok: false };
    return { ok: defaultSshManager.disconnect(target) };
  });

  ipcMain.handle('jewbot:sshExec', async (_event, payload: unknown) => {
    const req = asSshExec(payload);
    if (!req) return { ok: false, started: false, needsConfirmation: false, reason: 'Invalid SSH request' } satisfies SshStartResult;
    const prepared = defaultSshManager.prepareExec(req.command);
    if (!prepared.ok && !prepared.needsConfirmation) return prepared;
    if (!prepared.ok && prepared.needsConfirmation && !req.executionId) return prepared;
    try {
      const started = defaultSshManager.startExec(req.target, req.command, { executionId: req.executionId });
      return {
        ok: true,
        started: true,
        sessionId: started.sessionId,
        execId: started.execId,
      } satisfies SshStartResult;
    } catch (err) {
      const decision = (err as Error & { decision?: SafetyDecision }).decision;
      if (decision && !decision.ok) {
        return {
          ok: false,
          started: false,
          needsConfirmation: decision.needsConfirmation,
          reason: decision.reason,
          category: decision.category,
          pattern: decision.pattern,
        } satisfies SshStartResult;
      }
      return {
        ok: false,
        started: false,
        needsConfirmation: false,
        reason: err instanceof Error ? err.message : 'SSH exec failed',
      } satisfies SshStartResult;
    }
  });

  ipcMain.handle('jewbot:sshConfirm', async (_event, command: unknown) => {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000) {
      return { ok: false, started: false, reason: 'Invalid command' } satisfies SshStartResult;
    }
    const prepared = defaultSshManager.prepareExec(command);
    if (prepared.ok) return { ok: true, started: false, needsConfirmation: false } satisfies SshStartResult;
    if (!prepared.needsConfirmation) return { ...prepared, ok: false, started: false };
    const { executionId } = issueConfirmation(command);
    return {
      ok: true,
      started: false,
      needsConfirmation: true,
      executionId,
      reason: prepared.reason,
      category: prepared.category,
      pattern: prepared.pattern,
    } satisfies SshStartResult;
  });

  ipcMain.handle('jewbot:sshKill', async (_event, execId: unknown) => {
    if (typeof execId !== 'string' || !execId) return { killed: false };
    return { killed: defaultSshManager.killExec(execId) };
  });

  ipcMain.on('jewbot:sshHostKeyReply', (_event, payload: unknown) => {
    const reply = asHostKeyReply(payload);
    if (!reply) return;
    const finish = pendingHostKeys.get(reply.confirmId);
    if (!finish) return;
    finish(reply.approved);
  });

  ipcMain.on('jewbot:sshSecretReply', (_event, payload: unknown) => {
    const reply = asSecretReply(payload);
    if (!reply) return;
    const finish = pendingSecrets.get(reply.promptId);
    if (!finish) return;
    finish(reply.secret);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const ctrl of inflight.values()) ctrl.abort();
  inflight.clear();
  for (const finish of pendingConfirms.values()) finish(false);
  pendingConfirms.clear();
  for (const finish of pendingEdits.values()) finish(false);
  pendingEdits.clear();
  defaultTerminal.killAll();
  cascade.stop();
  void shutdownModules();
  defaultSshManager.closeAll();
  for (const finish of pendingHostKeys.values()) finish(false);
  pendingHostKeys.clear();
  for (const finish of pendingSecrets.values()) finish(null);
  pendingSecrets.clear();
  if (process.platform !== 'darwin') app.quit();
});

async function runUiEditSmoke(sender: WebContents, requestId: string, acceptGoal: boolean): Promise<void> {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jewbot-m3-ui-'));
  const ws = new FileWorkspace(tmp);
  const note = path.join(tmp, 'note.txt');
  await fs.promises.writeFile(note, 'old\n');
  const preview = await ws.proposeEdit('note.txt', 'hello from m3\n');
  undoTargets.set(preview.editId, ws);
  send(sender, { requestId, type: 'status', status: 'acting' });
  send(sender, {
    requestId,
    type: 'tool_call',
    name: 'write_file',
    args: { path: 'note.txt', content: 'hello from m3\n' },
  });
  const accepted = await requestEditDecision(
    sender,
    requestId,
    {
      editId: preview.editId,
      path: preview.filePath,
      unifiedDiff: preview.unifiedDiff,
      created: preview.created,
      secret: preview.secret,
      tool: 'write_file',
    },
    new AbortController().signal,
  );
  if (accepted) await ws.applyEdit(preview, true);
  const body = await fs.promises.readFile(note, 'utf8');
  await fs.promises.appendFile(
    '/tmp/jewbot-m3-ui-edit.jsonl',
    JSON.stringify({ goal: acceptGoal ? 'accept' : 'reject', accepted, body, tmp, editId: preview.editId }) + '\n',
  );
  const observation = accepted
    ? `APPLIED:\n${preview.unifiedDiff}`
    : 'REJECTED: edit of note.txt was not applied. The owner did not accept. Nothing was written.';
  send(sender, {
    requestId,
    type: 'tool_result',
    name: 'write_file',
    args: { path: 'note.txt' },
    observation,
  });
  send(sender, { requestId, type: 'done', status: 'done', finalText: accepted ? 'applied' : 'rejected' });
}

function requestEditDecision(
  sender: WebContents,
  requestId: string,
  req: EditConfirmRequest,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingEdits.delete(req.editId);
      signal.removeEventListener('abort', onAbort);
      resolve(accepted === true);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), process.env.JEWBOT_UI_SMOKE === '1' ? 8_000 : 120_000);
    pendingEdits.set(req.editId, finish);
    if (signal.aborted) {
      finish(false);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    send(sender, {
      requestId,
      type: 'edit_preview',
      editId: req.editId,
      path: req.path,
      unifiedDiff: req.unifiedDiff,
      created: req.created,
      secret: req.secret,
      tool: req.tool,
    });
  });
}

function requestOwnerConfirm(
  sender: WebContents,
  requestId: string,
  req: DestructiveConfirmRequest,
  signal: AbortSignal,
): Promise<boolean> {
  const confirmId = randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingConfirms.delete(confirmId);
      signal.removeEventListener('abort', onAbort);
      resolve(approved === true);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120_000);
    pendingConfirms.set(confirmId, finish);
    if (signal.aborted) {
      finish(false);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    send(sender, {
      requestId,
      type: 'confirm_required',
      confirmId,
      command: req.command,
      reason: req.reason,
      category: req.category,
    });
  });
}

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

function asTerminalStart(v: unknown): { command: string; executionId?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.command !== 'string' || !o.command.trim() || o.command.length > 4000) return null;
  if (o.executionId !== undefined && (typeof o.executionId !== 'string' || o.executionId.length > 80)) return null;
  return { command: o.command, executionId: typeof o.executionId === 'string' ? o.executionId : undefined };
}

function asEditReply(v: unknown): { editId: string; accepted: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.editId !== 'string' || !o.editId || o.editId.length > 80) return null;
  return { editId: o.editId, accepted: o.accepted === true };
}

function asConfirmReply(v: unknown): { confirmId: string; approved: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.confirmId !== 'string' || !o.confirmId || o.confirmId.length > 80) return null;
  return { confirmId: o.confirmId, approved: o.approved === true };
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

function bindSshEvents(): void {
  const broadcast = (payload: Record<string, unknown>) => {
    const contents = mainWindow?.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.send('jewbot:sshEvent', payload);
  };
  defaultSshManager.on('data', (chunk: SshExecChunk) => {
    broadcast({
      type: 'chunk',
      sessionId: chunk.sessionId,
      execId: chunk.execId,
      host: chunk.host,
      stream: chunk.stream,
      text: chunk.text,
    });
  });
  defaultSshManager.on('exec', (result: SshExecResult) => {
    broadcast({
      type: 'exit',
      sessionId: result.sessionId,
      execId: result.execId,
      host: result.host,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      killed: result.killed,
      truncated: result.truncated,
      timedOut: result.timedOut,
    });
  });
  defaultSshManager.on('connected', (info: SshSessionInfo) => {
    broadcast({ type: 'connected', ...info });
  });
  defaultSshManager.on('disconnected', (info: { sessionId: string; name: string }) => {
    broadcast({ type: 'disconnected', sessionId: info.sessionId, name: info.name });
  });
}

function prepareUiSmokeSsh(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m5-ui-'));
  const hostsPath = path.join(dir, 'hosts.json');
  const knownPath = path.join(dir, 'known_hosts.json');
  const keyPath = path.join(dir, 'id_ed25519');
  fs.writeFileSync(keyPath, '-----BEGIN OPENSSH PRIVATE KEY-----\njewbot-ui-smoke-key\n-----END OPENSSH PRIVATE KEY-----\n', {
    mode: 0o600,
  });
  fs.writeFileSync(
    hostsPath,
    JSON.stringify({
      hosts: [
        {
          name: 'pi',
          host: '127.0.0.1',
          port: 22,
          username: 'pi',
          privateKeyPath: keyPath,
          askPassphrase: true,
        },
      ],
    }),
  );
  uiSshExecs = [];
  uiSshPassOk = false;
  uiSshKnownPath = knownPath;
  const hostKey = Buffer.concat([sshString('ssh-ed25519'), Buffer.from('jewbot-ui-host-key')]);
  defaultSshManager.configure({
    hostsPath,
    knownHostsPath: knownPath,
    clientFactory: createScriptedClientFactory({
      hostKey,
      onConnect(config) {
        uiSshPassOk = config.passphrase === 'ui-pass-phrase-99';
      },
      onExec(command) {
        uiSshExecs.push(command);
        if (command.includes('jewbot-ssh-ui')) return { stdout: 'jewbot-ssh-ui\n', stderr: 'ssh-err\n', exitCode: 0 };
        return { stdout: '', exitCode: 0 };
      },
    }),
  });
}

function sshString(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function requestHostKey(sender: WebContents, req: HostKeyPrompt, signal?: AbortSignal): Promise<boolean> {
  const confirmId = randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingHostKeys.delete(confirmId);
      signal?.removeEventListener('abort', onAbort);
      resolve(approved === true);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 110_000);
    pendingHostKeys.set(confirmId, finish);
    if (signal?.aborted || sender.isDestroyed()) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    sender.send('jewbot:sshEvent', {
      type: 'hostkey_required',
      confirmId,
      name: req.name,
      host: req.host,
      port: req.port,
      fingerprint: req.fingerprint,
      algorithm: req.algorithm,
      mismatch: req.mismatch,
      previousFingerprint: req.previousFingerprint,
    });
  });
}

function requestSecret(sender: WebContents, req: SecretPrompt, signal?: AbortSignal): Promise<string | null> {
  const promptId = randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (secret: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingSecrets.delete(promptId);
      signal?.removeEventListener('abort', onAbort);
      resolve(secret && secret.trim() ? secret : null);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), 110_000);
    pendingSecrets.set(promptId, finish);
    if (signal?.aborted || sender.isDestroyed()) {
      finish(null);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    sender.send('jewbot:sshEvent', {
      type: 'secret_required',
      promptId,
      name: req.name,
      host: req.host,
      username: req.username,
      kind: req.kind,
    });
  });
}

function asSshExec(v: unknown): { target: string; command: string; executionId?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.target !== 'string' || !o.target.trim() || o.target.length > 80) return null;
  if (typeof o.command !== 'string' || !o.command.trim() || o.command.length > 4000) return null;
  if (o.executionId !== undefined && (typeof o.executionId !== 'string' || o.executionId.length > 80)) return null;
  return {
    target: o.target,
    command: o.command,
    executionId: typeof o.executionId === 'string' ? o.executionId : undefined,
  };
}

function asHostKeyReply(v: unknown): { confirmId: string; approved: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.confirmId !== 'string' || !o.confirmId || o.confirmId.length > 80) return null;
  return { confirmId: o.confirmId, approved: o.approved === true };
}

function asSecretReply(v: unknown): { promptId: string; secret: string | null } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.promptId !== 'string' || !o.promptId || o.promptId.length > 80) return null;
  if (typeof o.secret !== 'string' || !o.secret || o.secret.length > 1024) return { promptId: o.promptId, secret: null };
  return { promptId: o.promptId, secret: o.secret };
}

function bindCascadeEvents(): void {
  cascade.on('update', () => {
    const contents = mainWindow?.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.send('jewbot:cascadeEvent', cascade.snapshot());
  });
}

function smokeCascadeExecute(task: CascadeTask, signal: AbortSignal): Promise<CascadeAgentOutcome> {
  if (task.prompt.includes('__cascade_wait__')) {
    return new Promise((resolve) => {
      const finish = () => resolve({ status: 'blocked', reason: 'Stopped by owner', steps: [] });
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
    });
  }
  if (task.prompt.includes('__cascade_block__')) {
    return Promise.resolve({
      status: 'blocked',
      reason: 'Destructive shell pattern (rm -rf) requires owner confirmation before it can run.',
      steps: [{ n: 1, tool: 'run_terminal', observation: 'BLOCKED: command was not executed.' }],
    });
  }
  return Promise.resolve({
    status: 'done',
    finalText: 'cascade ok',
    steps: [{ n: 1, thought: 'FINAL: cascade ok' }],
  });
}

function asCascadeAdd(v: unknown): { title: string; prompt: string; acceptance?: string } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== 'string' || typeof o.prompt !== 'string') return null;
  if (o.acceptance !== undefined && typeof o.acceptance !== 'string') return null;
  return {
    title: o.title,
    prompt: o.prompt,
    acceptance: typeof o.acceptance === 'string' ? o.acceptance : undefined,
  };
}
