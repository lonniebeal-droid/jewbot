/**
 * SSH sessions over ssh2: allowlisted hosts, TOFU host keys, streamed exec.
 * Passphrases and passwords stay in memory for the life of the session and are never written.
 * Destructive commands run only with a one-shot grant from issueConfirmation.
 * `approved: true` and a caller-supplied execution id do not authorize anything.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import {
  checkShellCommand,
  consumeConfirmation,
  redactSecrets,
  SafetyDecision,
} from '../safety';
import {
  defaultHostsPath,
  defaultKnownHostsPath,
  describeHostKey,
  keyMaterialNeedsPassphrase,
  KnownHostEntry,
  loadHostsFile,
  parseHostEntry,
  readKnownHosts,
  SshHostConfig,
  SshHostPublic,
  toPublicHost,
  writeKnownHost,
} from './config';
import { isRealSsh2Client, SshClientFactory, SshClientLike, SshConnectConfig, SshExecStream, ssh2ClientFactory } from './transport';

export interface HostKeyPrompt {
  name: string;
  host: string;
  port: number;
  fingerprint: string;
  algorithm: string;
  mismatch: boolean;
  previousFingerprint?: string;
}

export interface SecretPrompt {
  name: string;
  host: string;
  username: string;
  kind: 'passphrase' | 'password';
}

export interface SshSessionInfo {
  sessionId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  fingerprint: string;
  connectedAt: string;
}

export interface SshExecChunk {
  sessionId: string;
  execId: string;
  host: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface SshExecResult {
  host: string;
  sessionId?: string;
  execId?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  status: 'EXECUTED' | 'FAILED' | 'BLOCKED' | 'TIMED_OUT';
  killed: boolean;
  truncated: boolean;
  timedOut: boolean;
}

export interface SshInventory {
  hosts: SshHostPublic[];
  sessions: SshSessionInfo[];
  configPath: string;
  knownHostsPath: string;
  error: string | null;
}

export interface ConnectOptions {
  confirmHostKey?: (req: HostKeyPrompt) => Promise<boolean>;
  promptSecret?: (req: SecretPrompt) => Promise<string | null>;
  signal?: AbortSignal;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onChunk?: (chunk: SshExecChunk) => void;
  /**
   * Ignored unless it is a live server-issued grant for this exact command.
   * Model- or caller-supplied ids do not authorize destructive commands.
   */
  executionId?: string;
  /** Accepted for older call sites. Does not authorize destructive commands. */
  approved?: boolean;
}

export interface SshStartResult {
  ok: boolean;
  started: boolean;
  sessionId?: string;
  execId?: string;
  needsConfirmation?: boolean;
  reason?: string;
  category?: string;
  pattern?: string;
  executionId?: string;
}

export interface StartedExec {
  execId: string;
  sessionId: string;
  done: Promise<SshExecResult>;
}

export interface SshManagerOptions {
  hostsPath?: string;
  knownHostsPath?: string;
  clientFactory?: SshClientFactory;
  /** When false, do not read the hosts file (unit tests register hosts themselves). */
  autoload?: boolean;
}

interface HeldSecret {
  passphrase?: string;
  password?: string;
  privateKey?: Buffer;
  privateKeyText?: string;
}

interface LiveSession {
  info: SshSessionInfo;
  client: SshClientLike;
  activeExecId?: string;
  redactions: string[];
}

interface LiveExec {
  execId: string;
  killed: boolean;
  timedOut: boolean;
  stream?: SshExecStream;
  timer?: NodeJS.Timeout;
  hardTimer?: NodeJS.Timeout;
  finish?: (code: number | null, failed?: string) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const READY_TIMEOUT_MS = 150_000;

export function formatSshObservation(result: SshExecResult): string {
  if (result.status === 'BLOCKED') {
    const reason = result.stderr.trim() || 'The command was not run.';
    return `BLOCKED: command was not executed. ${reason}`;
  }
  const lines = [
    `host: ${result.host}`,
    `status: ${result.status}`,
    `exit_code: ${result.exitCode === null ? 'null' : String(result.exitCode)}`,
    `timed_out: ${result.timedOut}`,
    `truncated: ${result.truncated}`,
    `killed: ${result.killed}`,
  ];
  if (result.stdout) lines.push('stdout:', result.stdout.trimEnd());
  if (result.stderr) lines.push('stderr:', result.stderr.trimEnd());
  return lines.join('\n');
}

export class SshManager extends EventEmitter {
  private hosts = new Map<string, SshHostConfig>();
  private sessions = new Map<string, LiveSession>();
  private byName = new Map<string, string>();
  private execs = new Map<string, LiveExec>();
  private secrets = new Map<string, HeldSecret>();
  private pending = new Map<string, Promise<SshSessionInfo>>();
  private hostsPath: string;
  private knownHostsPath: string;
  private clientFactory: SshClientFactory;
  private loadError: string | null = null;

  constructor(opts: SshManagerOptions = {}) {
    super();
    this.hostsPath = opts.hostsPath ?? defaultHostsPath();
    this.knownHostsPath = opts.knownHostsPath ?? defaultKnownHostsPath();
    this.clientFactory = opts.clientFactory ?? ssh2ClientFactory;
    if (opts.autoload !== false) this.reloadHosts();
  }

  configure(opts: SshManagerOptions): void {
    if (opts.hostsPath) this.hostsPath = opts.hostsPath;
    if (opts.knownHostsPath) this.knownHostsPath = opts.knownHostsPath;
    if (opts.clientFactory) this.clientFactory = opts.clientFactory;
    this.reloadHosts();
  }

  reloadHosts(): void {
    const loaded = loadHostsFile(this.hostsPath);
    this.loadError = loaded.error;
    this.hosts.clear();
    if (loaded.error) return;
    for (const host of loaded.hosts) this.hosts.set(host.name, host);
  }

  /** Programmatic allowlist entry. Rejects inline secrets the same way the file parser does. */
  registerHost(input: Record<string, unknown>): SshHostPublic {
    const name = typeof input.name === 'string' ? input.name : '';
    const seen = new Set([...this.hosts.keys()].filter((existing) => existing !== name));
    const cfg = parseHostEntry(input, 0, seen);
    this.hosts.set(cfg.name, cfg);
    return toPublicHost(cfg);
  }

  listHosts(): SshHostPublic[] {
    return [...this.hosts.values()].map(toPublicHost);
  }

  listSessions(): SshSessionInfo[] {
    return [...this.sessions.values()].map((session) => ({ ...session.info }));
  }

  inventory(): SshInventory {
    return {
      hosts: this.listHosts(),
      sessions: this.listSessions(),
      configPath: this.hostsPath,
      knownHostsPath: this.knownHostsPath,
      error: this.loadError,
    };
  }

  async connect(name: string, opts: ConnectOptions = {}): Promise<SshSessionInfo> {
    const cfg = this.hosts.get(name);
    if (!cfg) throw new Error(`Host not allowlisted: ${name}`);
    const existingId = this.byName.get(name);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing) return { ...existing.info };
    }
    const inflight = this.pending.get(name);
    if (inflight) return inflight;
    const promise = this.connectNew(cfg, opts);
    this.pending.set(name, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(name);
    }
  }

  disconnect(target: string): boolean {
    const session = this.resolveSession(target);
    if (!session) return false;
    this.dropSession(session.info.sessionId, true);
    return true;
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.dropSession(sessionId, true);
  }

  /** Classify only. Never opens a channel. */
  prepareExec(command: string): SshStartResult {
    const decision = checkShellCommand(command.trim(), { requireApproval: false });
    if (decision.ok) return { ok: true, started: false };
    return {
      ok: false,
      started: false,
      needsConfirmation: decision.needsConfirmation,
      reason: decision.reason,
      category: decision.category,
      pattern: decision.pattern,
    };
  }

  startExec(target: string, command: string, opts: ExecOptions = {}): StartedExec {
    const trimmed = command.trim();
    const session = this.resolveSession(target);
    if (!session) throw plainError(`Not connected to "${target}". Call ssh_connect first.`);
    if (!this.hosts.has(session.info.name)) throw plainError(`Host not allowlisted: ${session.info.name}`);
    assertExecAllowed(trimmed, opts.executionId);
    if (session.activeExecId) {
      throw plainError(`A command is already running on ${session.info.name}. Kill it before starting another.`);
    }

    const execId = randomUUID();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_BYTES;
    const secrets = session.redactions;
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let exitCode: number | null = null;
    let sawExit = false;
    let finished = false;
    let resolveDone!: (result: SshExecResult) => void;
    const done = new Promise<SshExecResult>((resolve) => {
      resolveDone = resolve;
    });

    const live: LiveExec = { execId, killed: false, timedOut: false };
    this.execs.set(execId, live);
    session.activeExecId = execId;

    const finish = (code: number | null, failed?: string) => {
      if (finished) return;
      finished = true;
      if (live.timer) clearTimeout(live.timer);
      if (live.hardTimer) clearTimeout(live.hardTimer);
      if (session.activeExecId === execId) session.activeExecId = undefined;
      this.execs.delete(execId);
      const errorText = failed ? redactSecrets(failed, secrets) : '';
      const result: SshExecResult = {
        host: session.info.name,
        sessionId: session.info.sessionId,
        execId,
        exitCode: code,
        stdout,
        stderr: errorText ? (stderr ? `${stderr}${errorText}` : errorText) : stderr,
        status: live.timedOut ? 'TIMED_OUT' : failed ? 'FAILED' : 'EXECUTED',
        killed: live.killed,
        truncated,
        timedOut: live.timedOut,
      };
      this.emit('exec', result);
      resolveDone(result);
    };
    live.finish = finish;

    const push = (stream: 'stdout' | 'stderr', text: string) => {
      const redacted = redactSecrets(text, secrets);
      const chunk: SshExecChunk = {
        sessionId: session.info.sessionId,
        execId,
        host: session.info.name,
        stream,
        text: redacted,
      };
      this.emit('data', chunk);
      opts.onChunk?.(chunk);
      const bucket = stream === 'stdout' ? stdout : stderr;
      if (bucket.length >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const next = bucket + redacted;
      const clipped = next.length > maxOutputBytes ? next.slice(0, maxOutputBytes) : next;
      if (clipped.length !== next.length) truncated = true;
      if (stream === 'stdout') stdout = clipped;
      else stderr = clipped;
    };

    try {
      session.client.exec(trimmed, {}, (err, stream) => {
        if (finished) return;
        if (err || !stream) {
          finish(null, err?.message ?? 'SSH exec failed');
          return;
        }
        live.stream = stream;
        stream.on('data', (data) => push('stdout', asText(data)));
        stream.stderr.on('data', (data) => push('stderr', asText(data)));
        stream.on('exit', (code) => {
          sawExit = true;
          exitCode = typeof code === 'number' ? code : null;
        });
        stream.on('close', (code) => {
          if (!sawExit && typeof code === 'number') exitCode = code;
          finish(exitCode);
        });
      });
    } catch (err) {
      finish(null, err instanceof Error ? err.message : 'SSH exec failed');
    }

    live.timer = setTimeout(() => {
      if (finished) return;
      live.timedOut = true;
      live.killed = true;
      this.killStream(live);
    }, timeoutMs);

    if (opts.signal) {
      const abort = () => {
        if (finished) return;
        live.killed = true;
        this.killStream(live);
      };
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener('abort', abort, { once: true });
    }

    return { execId, sessionId: session.info.sessionId, done };
  }

  async exec(target: string, command: string, opts: ExecOptions = {}): Promise<SshExecResult> {
    try {
      const started = this.startExec(target, command, opts);
      return await started.done;
    } catch (err) {
      return this.resultFromError(target, err);
    }
  }

  killExec(execId: string): boolean {
    const live = this.execs.get(execId);
    if (!live) return false;
    live.killed = true;
    this.killStream(live);
    return true;
  }

  private async connectNew(cfg: SshHostConfig, opts: ConnectOptions): Promise<SshSessionInfo> {
    if (opts.signal?.aborted) throw new Error('SSH connect cancelled');
    let held: HeldSecret = {};
    try {
      held = await this.collectSecret(cfg, opts);
      if (opts.signal?.aborted) throw new Error('SSH connect cancelled');
      const client = this.clientFactory();
      const fingerprint = await this.openClient(client, cfg, held, opts);
      const info: SshSessionInfo = {
        sessionId: randomUUID(),
        name: cfg.name,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        fingerprint,
        connectedAt: new Date().toISOString(),
      };
      const redactions = [held.passphrase, held.password, held.privateKeyText].filter(
        (value): value is string => typeof value === 'string' && value.length >= 8,
      );
      const session: LiveSession = { info, client, redactions };
      this.sessions.set(info.sessionId, session);
      this.byName.set(cfg.name, info.sessionId);
      if (held.passphrase || held.password || held.privateKeyText) this.secrets.set(cfg.name, held);
      client.on('close', () => {
        if (this.sessions.has(info.sessionId)) this.dropSession(info.sessionId, false);
      });
      client.on('error', () => {
        if (this.sessions.has(info.sessionId)) this.dropSession(info.sessionId, true);
      });
      this.emit('connected', { ...info });
      return { ...info };
    } catch (err) {
      throw new Error(this.safeMessage(err, held));
    }
  }

  private async collectSecret(cfg: SshHostConfig, opts: ConnectOptions): Promise<HeldSecret> {
    const held: HeldSecret = {};
    if (cfg.auth === 'agent') {
      if (!process.env.SSH_AUTH_SOCK) {
        throw new Error(`Host "${cfg.name}" uses ssh-agent but SSH_AUTH_SOCK is unset`);
      }
      return held;
    }
    if (cfg.auth === 'password') {
      held.password = await this.askSecret(cfg, opts, 'password');
      return held;
    }
    const loaded = readPrivateKey(cfg);
    held.privateKey = loaded.key;
    held.privateKeyText = loaded.text;
    if (cfg.askPassphrase || keyMaterialNeedsPassphrase(loaded.text)) {
      held.passphrase = await this.askSecret(cfg, opts, 'passphrase');
    }
    return held;
  }

  private async askSecret(cfg: SshHostConfig, opts: ConnectOptions, kind: SecretPrompt['kind']): Promise<string> {
    if (!opts.promptSecret) {
      throw new Error(`${kind === 'password' ? 'Password' : 'Passphrase'} required for "${cfg.name}" and no prompt is available`);
    }
    const value = await opts.promptSecret({
      name: cfg.name,
      host: cfg.host,
      username: cfg.username,
      kind,
    });
    if (!value || !value.trim()) {
      throw new Error(`${kind === 'password' ? 'Password' : 'Passphrase'} prompt for "${cfg.name}" was cancelled`);
    }
    return value;
  }

  private openClient(client: SshClientLike, cfg: SshHostConfig, held: HeldSecret, opts: ConnectOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        try {
          client.end();
        } catch {
          /* already closed */
        }
        reject(err);
      };
      const succeed = (fingerprint: string) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(fingerprint);
      };
      const onAbort = () => fail(new Error('SSH connect cancelled'));
      if (opts.signal?.aborted) {
        fail(new Error('SSH connect cancelled'));
        return;
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      let fingerprint = '';
      client.on('ready', () => succeed(fingerprint));
      client.on('error', (err) => fail(err instanceof Error ? err : new Error('SSH connection failed')));
      try {
        client.connect(this.connectConfig(cfg, held, opts, (next) => {
          fingerprint = next;
        }));
      } catch (err) {
        fail(err instanceof Error ? err : new Error('SSH connect failed'));
      }
    });
  }

  private connectConfig(
    cfg: SshHostConfig,
    held: HeldSecret,
    opts: ConnectOptions,
    rememberFingerprint: (fingerprint: string) => void,
  ): SshConnectConfig {
    const config: SshConnectConfig = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: 15_000,
      tryKeyboard: false,
      hostVerifier: (key, verify) => {
        const described = describeHostKey(key);
        void this.decideHostKey(cfg, described, opts.confirmHostKey)
          .then((ok) => {
            if (ok) rememberFingerprint(described.fingerprint);
            verify(ok);
          })
          .catch(() => verify(false));
      },
    };
    if (cfg.auth === 'agent') {
      config.agent = process.env.SSH_AUTH_SOCK;
      config.authHandler = ['agent'];
    } else if (cfg.auth === 'password') {
      config.password = held.password;
      config.authHandler = ['password'];
    } else {
      if (held.privateKey) config.privateKey = held.privateKey;
      if (held.passphrase) config.passphrase = held.passphrase;
      config.authHandler = ['publickey'];
    }
    return config;
  }

  private async decideHostKey(
    cfg: SshHostConfig,
    described: { fingerprint: string; algorithm: string },
    confirm: ConnectOptions['confirmHostKey'],
  ): Promise<boolean> {
    const current = readKnownHosts(this.knownHostsPath).find((row) => row.host === cfg.host && row.port === cfg.port);
    if (current && current.fingerprint === described.fingerprint) return true;
    if (!confirm) return false;
    let accepted = false;
    try {
      accepted =
        (await confirm({
          name: cfg.name,
          host: cfg.host,
          port: cfg.port,
          fingerprint: described.fingerprint,
          algorithm: described.algorithm,
          mismatch: Boolean(current),
          previousFingerprint: current?.fingerprint,
        })) === true;
    } catch {
      accepted = false;
    }
    if (!accepted) return false;
    const entry: KnownHostEntry = {
      name: cfg.name,
      host: cfg.host,
      port: cfg.port,
      fingerprint: described.fingerprint,
      algorithm: described.algorithm,
      confirmedAt: new Date().toISOString(),
    };
    writeKnownHost(this.knownHostsPath, entry);
    const saved = readKnownHosts(this.knownHostsPath).find((row) => row.host === cfg.host && row.port === cfg.port);
    return saved?.fingerprint === described.fingerprint;
  }

  private resolveSession(target: string): LiveSession | undefined {
    const direct = this.sessions.get(target);
    if (direct) return direct;
    const byName = this.byName.get(target);
    if (!byName) return undefined;
    return this.sessions.get(byName);
  }

  private dropSession(sessionId: string, endClient: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.activeExecId) this.killExec(session.activeExecId);
    this.secrets.delete(session.info.name);
    this.sessions.delete(sessionId);
    this.byName.delete(session.info.name);
    if (endClient) {
      try {
        session.client.end();
      } catch {
        /* already closed */
      }
    }
    this.emit('disconnected', { sessionId, name: session.info.name });
  }

  private killStream(live: LiveExec): void {
    try {
      live.stream?.signal?.('TERM');
    } catch {
      /* already gone */
    }
    try {
      live.stream?.close();
    } catch {
      /* already gone */
    }
    if (live.hardTimer || !this.execs.has(live.execId)) return;
    live.hardTimer = setTimeout(() => {
      live.finish?.(null);
    }, 1000);
  }

  private resultFromError(target: string, err: unknown): SshExecResult {
    const decision = (err as Error & { decision?: SafetyDecision }).decision;
    const reason = decision && !decision.ok ? decision.reason : err instanceof Error ? err.message : 'SSH exec failed';
    const session = this.resolveSession(target);
    return {
      host: session?.info.name ?? target,
      sessionId: session?.info.sessionId,
      exitCode: null,
      stdout: '',
      stderr: redactSecrets(reason, session?.redactions ?? []),
      status: 'BLOCKED',
      killed: false,
      truncated: false,
      timedOut: false,
    };
  }

  private safeMessage(err: unknown, held: HeldSecret): string {
    const message = err instanceof Error ? err.message : 'SSH connection failed';
    const extra = [held.passphrase, held.password, held.privateKeyText].filter(
      (value): value is string => typeof value === 'string' && value.length >= 8,
    );
    return redactSecrets(message, extra);
  }
}

export const defaultSshManager = new SshManager();

/** Allowlist helper mirroring ju_fleet_remote_probe style. */
export function assertAllowlistedHost(name: string, allow: string[]): void {
  if (!allow.includes(name)) throw new Error(`Host not allowlisted: ${name}`);
}

export function ssh2FactoryUsesRealClient(): boolean {
  const client = ssh2ClientFactory();
  return isRealSsh2Client(client);
}

function assertExecAllowed(command: string, executionId?: string): void {
  const decision = checkShellCommand(command, { requireApproval: false });
  if (decision.ok) return;
  if (decision.needsConfirmation && consumeConfirmation(executionId, command)) return;
  const err = new Error(`[safety] ${decision.reason}`);
  (err as Error & { decision?: SafetyDecision }).decision = decision;
  throw err;
}

function plainError(message: string): Error {
  return new Error(message);
}

function asText(data: Buffer | string): string {
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
}

function readPrivateKey(cfg: SshHostConfig): { key: Buffer; text: string } {
  if (!cfg.privateKeyPath) throw new Error(`Host "${cfg.name}" has no private key path`);
  try {
    const stat = fs.statSync(cfg.privateKeyPath);
    if (!stat.isFile()) throw new Error(`Private key for "${cfg.name}" is not a file`);
    if (stat.size <= 0 || stat.size > 64 * 1024) throw new Error(`Private key for "${cfg.name}" has an unexpected size`);
    const key = fs.readFileSync(cfg.privateKeyPath);
    return { key, text: key.toString('utf8') };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Private key')) throw err;
    throw new Error(`Private key for "${cfg.name}" could not be read`);
  }
}

export type { SshHostConfig, SshHostPublic };
export { createScriptedClientFactory } from './scripted';
export { describeHostKey, defaultHostsPath, defaultKnownHostsPath } from './config';
export { ssh2ClientFactory } from './transport';
export type { SshConnectConfig } from './transport';
