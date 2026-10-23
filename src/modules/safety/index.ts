/**
 * Safety rails: $0 spend by default; destructive ops need confirmation.
 * Patterns inspired by ju-agent (approved + executionId) and ju-command-center human gates.
 */

export type SafetyDecision =
  | { ok: true }
  | { ok: false; reason: string; needsConfirmation: boolean; category: SafetyCategory };

export type SafetyCategory =
  | 'spend'
  | 'destructive_shell'
  | 'destructive_git'
  | 'path_jail'
  | 'unapproved';

const DESTRUCTIVE_SHELL = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)*-?[a-zA-Z]*r[a-zA-Z]*f\b/i,
  /\brm\s+-rf\b/i,
  /\brm\s+-fr\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  />\s*\/dev\/sd/i,
];

const DESTRUCTIVE_GIT = [
  /\bgit\s+push\b.*--force\b/i,
  /\bgit\s+push\b.*\s-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-zA-Z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
];

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

  for (const re of DESTRUCTIVE_SHELL) {
    if (re.test(trimmed)) {
      if (opts.approved === true && opts.executionId) return { ok: true };
      return {
        ok: false,
        reason: `Destructive shell pattern blocked: requires owner confirmation + executionId`,
        needsConfirmation: true,
        category: 'destructive_shell',
      };
    }
  }

  for (const re of DESTRUCTIVE_GIT) {
    if (re.test(trimmed)) {
      if (opts.approved === true && opts.executionId) return { ok: true };
      return {
        ok: false,
        reason: `Destructive git pattern blocked: requires owner confirmation + executionId`,
        needsConfirmation: true,
        category: 'destructive_git',
      };
    }
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
