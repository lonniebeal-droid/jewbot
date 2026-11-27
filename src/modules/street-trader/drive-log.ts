/**
 * Append-only local session log for Street Trader.
 * The Drive exporter is stubbed and off. It names the Master 3 continuation
 * doc and does not call Google, and this file holds no credentials.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Receipts continuation doc from the 2026-11-06 module spec. Not Master 2. */
export const MASTER3_CONTINUATION_DOC_ID = '1kuCWpWMGtpaeo8UOnvvZh9AnrLLQfTD188Ko1i_Tmq4';

export type DriveLogKind = 'RECEIPT' | 'CLAIM' | 'STATUS' | 'BLOCKER';

export interface DriveLogInput {
  task: string;
  kind?: DriveLogKind;
  section?: string;
  detail?: string;
}

export interface DriveLogLine {
  at: string;
  kind: DriveLogKind;
  spend: '$0';
  task: string;
  section?: string;
  line: string;
  exported: false;
}

export function driveLogPath(file?: string): string {
  const fromEnv = process.env.JEWBOT_STREET_DRIVE_LOG?.trim();
  return file?.trim() || fromEnv || path.join(os.homedir(), '.jewbot', 'street-trader', 'drive-log.jsonl');
}

export function formatEt(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ET`;
}

function oneLine(value: string, max = 240): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function formatDriveLine(input: DriveLogInput, at = formatEt()): string {
  const task = oneLine(input.task || 'session');
  const kind = input.kind || 'RECEIPT';
  if (kind === 'BLOCKER') {
    const error = oneLine(input.detail || 'local model offline');
    return `BLOCKER ${at} — Street Trader — ${error} — tried: local Ollama only — cascading to keyword curriculum — $0`;
  }
  if (kind === 'CLAIM') {
    return `CLAIM ${at} — Street Trader (Jewbot/Ollama) — ${task} — IN PROGRESS — $0`;
  }
  if (kind === 'STATUS') {
    return `STATUS ${at.slice(0, 10)} — Street Trader — ${task} — next = ${oneLine(input.detail || 'keep teaching')} — $0`;
  }
  const section = input.section ? ` section: ${oneLine(input.section, 120)}` : '';
  return `RECEIPT ${at} — Street Trader (Jewbot/Ollama) — ${task}${section} — COMPLETE — links: local — $0`;
}

/** Append one JSON line. Does not rewrite earlier lines. */
export function appendDriveLog(input: DriveLogInput, file?: string): DriveLogLine {
  const task = oneLine(input.task);
  if (!task) throw new Error('drive_log needs a task.');
  const at = formatEt();
  const record: DriveLogLine = {
    at,
    kind: input.kind || 'RECEIPT',
    spend: '$0',
    task,
    section: input.section ? oneLine(input.section, 160) : undefined,
    line: formatDriveLine(input, at),
    exported: false,
  };
  const target = driveLogPath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  return record;
}

export interface DriveExportResult {
  ok: false;
  exported: false;
  targetDocId: string;
  reason: string;
}

/**
 * Optional exporter. Off unless JEWBOT_STREET_DRIVE_EXPORT=1, and even then
 * it stays a stub: no network call and no credential lookup.
 */
export function exportDriveLog(): DriveExportResult {
  const targetDocId = MASTER3_CONTINUATION_DOC_ID;
  if (process.env.JEWBOT_STREET_DRIVE_EXPORT !== '1') {
    return {
      ok: false,
      exported: false,
      targetDocId,
      reason: 'Drive export is off. Receipts stay in the local JSONL file.',
    };
  }
  return {
    ok: false,
    exported: false,
    targetDocId,
    reason: 'Drive export is stubbed. No credentials are stored in the repo, and this build does not call Google.',
  };
}
