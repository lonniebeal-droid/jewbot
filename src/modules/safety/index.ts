/**
 * Safety rails: $0 spend by default; destructive ops need confirmation.
 * Patterns inspired by ju-agent (approved + executionId) and ju-command-center human gates.
 *
 * Classification (`checkShellCommand`) can record that a caller *claims* approval.
 * That claim is not enough to run a command. `issueConfirmation` / `consumeConfirmation`
 * are the one-shot grant a human confirm dialog must obtain. The agent never receives
 * a grant, and a model-supplied executionId does not match this store.
 */

import { randomUUID } from 'crypto';

export type SafetyDecision =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      needsConfirmation: boolean;
      category: SafetyCategory;
      pattern?: string;
    };

export type SafetyCategory =
  | 'spend'
  | 'destructive_shell'
  | 'destructive_git'
  | 'path_jail'
  | 'unapproved';

interface DestructiveHit {
  category: 'destructive_shell' | 'destructive_git';
  pattern: string;
  reason: string;
}

const GRANT_TTL_MS = 5 * 60 * 1000;

interface ConfirmationGrant {
  command: string;
  expiresAt: number;
}

const confirmationGrants = new Map<string, ConfirmationGrant>();

export interface SafetyConfig {
  /** Owner must explicitly set true to allow any paid/cloud LLM provider. */
  allowPaidApis: boolean;
  /** Project root for path jail. */
  projectRoot: string;
  /** When true, high-risk shell requires approved + executionId. */
  requireShellApproval: boolean;
}

export const defaultSafetyConfig = (projectRoot: string): SafetyConfig => ({
  allowPaidApis: process.env.JEWBOT_ALLOW_PAID === '1',
  projectRoot,
  requireShellApproval: true,
});

export function assertLocalSpendOnly(allowPaidApis: boolean): SafetyDecision {
  if (allowPaidApis) return { ok: true };
  return {
    ok: false,
    reason: 'Paid/cloud LLM APIs are disabled ($0 default). Set JEWBOT_ALLOW_PAID=1 only after owner approval.',
    needsConfirmation: true,
    category: 'spend',
  };
}

/**
 * Classify a shell command. Does not execute anything.
 * `approved` + `executionId` only short-circuits classification for callers that
 * already verified a grant. Terminal execution ignores this short-circuit and
 * calls `consumeConfirmation` itself.
 */
export function checkShellCommand(
  command: string,
  opts: { approved?: boolean; executionId?: string; requireApproval?: boolean } = {},
): SafetyDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Empty command', needsConfirmation: false, category: 'unapproved' };
  }
  if (trimmed.length > 4000) {
    return { ok: false, reason: 'Command too long', needsConfirmation: false, category: 'unapproved' };
  }

  const hit = detectDestructive(trimmed);
  if (hit) {
    const claimed =
      opts.approved === true && typeof opts.executionId === 'string' && opts.executionId.trim().length >= 8;
    if (claimed) return { ok: true };
    return {
      ok: false,
      reason: hit.reason,
      needsConfirmation: true,
      category: hit.category,
      pattern: hit.pattern,
    };
  }

  if (opts.requireApproval && opts.approved !== true) {
    return {
      ok: false,
      reason: 'Shell requires explicit approval',
      needsConfirmation: true,
      category: 'unapproved',
    };
  }

  return { ok: true };
}

/**
 * Mint a one-shot id after the owner confirms `command` in the UI.
 * The id runs only that exact string, once, and then expires.
 */
export function issueConfirmation(command: string): { executionId: string } {
  const executionId = `exec_${randomUUID()}`;
  confirmationGrants.set(executionId, {
    command: command.trim(),
    expiresAt: Date.now() + GRANT_TTL_MS,
  });
  return { executionId };
}

/** Returns true only for a live grant of this exact command. Always burns the id. */
export function consumeConfirmation(executionId: string | undefined, command: string): boolean {
  if (!executionId) return false;
  const grant = confirmationGrants.get(executionId);
  if (!grant) return false;
  confirmationGrants.delete(executionId);
  if (Date.now() > grant.expiresAt) return false;
  return grant.command === command.trim();
}

/** Test helper. */
export function resetConfirmations(): void {
  confirmationGrants.clear();
}

export function assertInsideProject(projectRoot: string, targetPath: string): SafetyDecision {
  const path = require('path') as typeof import('path');
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(projectRoot, targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return {
      ok: false,
      reason: `Path escapes project root: ${targetPath}`,
      needsConfirmation: false,
      category: 'path_jail',
    };
  }
  return { ok: true };
}

export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  const envToken = process.env.JU_SHELL_TOKEN || process.env.JEWBOT_SHELL_TOKEN;
  const list = [...secrets, envToken].filter(Boolean) as string[];
  for (const s of list) {
    if (s.length >= 8) out = out.split(s).join('[REDACTED]');
  }
  return out;
}

function detectDestructive(command: string): DestructiveHit | null {
  const segments = splitSegments(command);
  for (const segment of segments) {
    const tokens = tokenize(segment);
    const hit = detectTokens(tokens);
    if (hit) return hit;
  }
  return detectRaw(command);
}

function detectTokens(tokens: string[]): DestructiveHit | null {
  if (!tokens.length) return null;
  const rest = stripWrappers(tokens);
  if (!rest.length) return null;
  const bin = basename(rest[0]);

  if (bin === 'rm' && isForceRecursiveRm(rest)) {
    return shellHit('rm-rf', 'rm -rf (recursive force delete)');
  }
  if (bin === 'mkfs' || bin.startsWith('mkfs.')) {
    return shellHit('mkfs', bin);
  }
  if (bin === 'dd' && rest.slice(1).some((t) => /^(of|if)=/.test(t))) {
    const which = rest.some((t) => /^of=/.test(t)) ? 'dd of=' : 'dd if=';
    return shellHit('dd', which);
  }
  if (bin === 'chmod' && isDangerousChmod(rest)) {
    return shellHit('chmod', 'chmod of / or recursive 777/666');
  }
  if (bin === 'shutdown' || bin === 'reboot' || bin === 'poweroff' || bin === 'halt') {
    return shellHit(bin, bin);
  }

  const git = detectGit(rest);
  if (git) return git;
  return null;
}

function shellHit(pattern: string, label: string): DestructiveHit {
  return {
    category: 'destructive_shell',
    pattern,
    reason: `Destructive shell pattern (${label}) requires owner confirmation before it can run.`,
  };
}

function gitHit(pattern: string, label: string): DestructiveHit {
  return {
    category: 'destructive_git',
    pattern,
    reason: `Destructive git pattern (${label}) requires owner confirmation before it can run.`,
  };
}

function isForceRecursiveRm(rest: string[]): boolean {
  let recursive = false;
  let force = false;
  for (let i = 1; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--') break;
    if (t === '--recursive') recursive = true;
    else if (t === '--force') force = true;
    else if (t.startsWith('--')) continue;
    else if (t.startsWith('-')) {
      const flags = t.slice(1);
      if (/[rR]/.test(flags)) recursive = true;
      if (flags.includes('f')) force = true;
    }
  }
  return recursive && force;
}

function isDangerousChmod(rest: string[]): boolean {
  let recursive = false;
  let mode: string | null = null;
  const paths: string[] = [];
  for (let i = 1; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--') {
      paths.push(...rest.slice(i + 1));
      break;
    }
    if (t === '-R' || t === '--recursive') {
      recursive = true;
      continue;
    }
    if (t.startsWith('--')) continue;
    if (t.startsWith('-')) {
      if (t.includes('R')) recursive = true;
      continue;
    }
    if (mode === null) mode = t;
    else paths.push(t);
  }
  if (!mode) return false;
  const hitsRoot = paths.some((p) => p === '/' || p === '/*' || p === '/.' || p === '//' || p.startsWith('/*'));
  if (hitsRoot) return true;
  const worldOrWipe = /^(0*777|0*666|0*000|a\+rwx|a=rwx)$/.test(mode);
  return recursive && worldOrWipe;
}

function detectGit(rest: string[]): DestructiveHit | null {
  if (basename(rest[0]) !== 'git') return null;
  let i = 1;
  while (i < rest.length && rest[i].startsWith('-')) {
    const flag = rest[i];
    i++;
    if (flag === '-C' || flag === '--git-dir' || flag === '--work-tree' || flag === '--namespace') i++;
  }
  const sub = rest[i];
  const args = rest.slice(i + 1);
  if (!sub) return null;

  if (sub === 'push') {
    const force = args.some(
      (t) =>
        t === '--force' ||
        t === '-f' ||
        t === '--force-with-lease' ||
        t.startsWith('--force=') ||
        t.startsWith('--force-with-lease=') ||
        /^\+[^\s+]/.test(t),
    );
    if (force) return gitHit('git-push-force', 'git push --force');
  }
  if (sub === 'reset' && args.includes('--hard')) return gitHit('git-reset-hard', 'git reset --hard');
  if (sub === 'clean') {
    const forced = args.some(
      (t) => t === '--force' || t === '-f' || (t.startsWith('-') && !t.startsWith('--') && t.includes('f')),
    );
    if (forced) return gitHit('git-clean-force', 'git clean -f');
  }
  if (sub === 'branch') {
    const forceDelete = args.some((t) => t === '-D' || (t.startsWith('-') && !t.startsWith('--') && t.includes('D')));
    if (forceDelete) return gitHit('git-branch-D', 'git branch -D');
  }
  return null;
}

function detectRaw(command: string): DestructiveHit | null {
  if (rawForceRecursiveRm(command)) return shellHit('rm-rf', 'rm -rf (recursive force delete)');
  if (/\bmkfs(\.[a-z0-9]+)?\b/i.test(command)) return shellHit('mkfs', 'mkfs');
  if (/\bdd\b[\s\S]{0,200}\bof=/i.test(command)) return shellHit('dd', 'dd of=');
  if (/\bdd\b[\s\S]{0,200}\bif=/i.test(command)) return shellHit('dd', 'dd if=');
  if (/\bchmod\b[\s\S]{0,120}(\s\/\s|\s\/$|\s\/\*)/i.test(command) && /\bchmod\b[\s\S]{0,80}(-R|--recursive|\s\/)/i.test(command)) {
    return shellHit('chmod', 'chmod of /');
  }
  if (/\bchmod\s+(?:-R|--recursive)\s+(?:0*777|0*666|a\+rwx)\b/i.test(command)) {
    return shellHit('chmod', 'chmod -R 777');
  }
  if (/\b(shutdown|reboot|poweroff|halt)\b/i.test(command)) return shellHit('power', 'shutdown/reboot');
  if (/>\|?\s*\/dev\/(sd|nvme|vd|xvd|mmcblk|disk)/i.test(command)) return shellHit('block-redirect', 'redirect to block device');
  if (/:\(\)\s*\{[^}]*:\s*\|\s*:/.test(command)) return shellHit('fork-bomb', 'fork bomb');
  if (/\bgit\s+push\b[\s\S]{0,200}(--force\b|-f\b|--force-with-lease\b)/i.test(command)) {
    return gitHit('git-push-force', 'git push --force');
  }
  if (/\bgit\s+reset\b[\s\S]{0,80}--hard\b/i.test(command)) return gitHit('git-reset-hard', 'git reset --hard');
  if (/\bgit\s+clean\b[\s\S]{0,40}-[a-zA-Z]*f/i.test(command)) return gitHit('git-clean-force', 'git clean -f');
  if (/\bgit\s+branch\b[\s\S]{0,40}-[A-Za-z]*D/.test(command)) return gitHit('git-branch-D', 'git branch -D');
  return null;
}

function rawForceRecursiveRm(command: string): boolean {
  if (/\brm\s+-\w*[rR]\w*f\w*/i.test(command)) return true;
  if (/\brm\s+-\w*f\w*[rR]\w*/i.test(command)) return true;
  const hasR = /\brm\b[\s\S]{0,80}(\s-\w*[rR]\w*\b|\s--recursive\b)/i.test(command);
  const hasF = /\brm\b[\s\S]{0,80}(\s-\w*f\w*\b|\s--force\b)/i.test(command);
  return hasR && hasF;
}

function splitSegments(command: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"') {
        if (i + 1 < command.length) {
          cur += command[i + 1];
          i++;
        }
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '|' && command[i + 1] === '|') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '|' || ch === ';' || ch === '\n' || ch === '&') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        if (i + 1 < segment.length) cur += segment[++i];
        continue;
      }
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      cur += segment[++i];
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function stripWrappers(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  while (i < tokens.length) {
    const bin = basename(tokens[i]);
    if (bin === 'sudo') {
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) {
        const flag = tokens[i];
        i++;
        if (flag === '--') break;
        if ((flag === '-u' || flag === '-g' || flag === '-C') && i < tokens.length) i++;
      }
      continue;
    }
    if (bin === 'command' || bin === 'time' || bin === 'nice' || bin === 'nohup') {
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) i++;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

function basename(token: string | undefined): string {
  if (!token) return '';
  const slash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  return slash >= 0 ? token.slice(slash + 1) : token;
}
