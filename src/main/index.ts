import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { defaultOllamaConfig, listModels } from '../modules/llm';
import { defaultTerminal } from '../modules/terminal';
import { defaultSshManager } from '../modules/ssh';
import { FileWorkspace } from '../modules/files';
import { ContextIndexer } from '../modules/context';
import { AgentLoop } from '../modules/agent';
import { CascadeRunner, M0_MILESTONE } from '../modules/cascade';
import { defaultSafetyConfig, assertLocalSpendOnly } from '../modules/safety';

let mainWindow: BrowserWindow | null = null;
const projectRoot = process.cwd();
const safety = defaultSafetyConfig(projectRoot);
const files = new FileWorkspace(projectRoot);
const context = new ContextIndexer(projectRoot);
const cascade = new CascadeRunner();

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
}

app.whenReady().then(() => {
  createWindow();
  cascade.enqueue({
    ...M0_MILESTONE,
    status: 'pending',
    run: async () => ({ status: 'done', detail: M0_MILESTONE.detail }),
  });

  ipcMain.handle('jewbot:status', async () => {
    const spend = assertLocalSpendOnly(safety.allowPaidApis);
    let models: string[] = [];
    try {
      models = await listModels(defaultOllamaConfig());
    } catch {
      models = [];
    }
    return {
      version: '0.1.0',
      milestone: 'M0',
      projectRoot,
      allowPaidApis: safety.allowPaidApis,
      spendGate: spend,
      ollama: defaultOllamaConfig(),
      models,
      hosts: defaultSshManager.listHosts(),
      cascade: cascade.list().map((m) => ({ id: m.id, title: m.title, status: m.status })),
    };
  });

  ipcMain.handle('jewbot:agentRun', async (_e, goal: string) => {
    const agent = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
    });
    return agent.run(goal);
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
  if (process.platform !== 'darwin') app.quit();
});
