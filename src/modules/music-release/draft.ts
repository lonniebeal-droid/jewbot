/**
 * Optional local draft of weekly album notes.
 *
 * Uses `assertLocalSpendOnly` and `chatOnce` from the Ollama helper.
 * A non-local or paid host is refused before a socket opens, including when
 * JEWBOT_ALLOW_PAID=1. This file does not upload a release.
 */

import type { OllamaConfig } from '../llm/ollama';
import {
  assertOllamaAllowed,
  chatOnce,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
} from '../llm/ollama';
import { assertLocalSpendOnly } from '../safety';
import type { MusicRelease } from './queue';

const DRAFT_CHARS = 2_000;

export function resolveMusicDraftConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const explicitHost = partial?.host?.trim();
  const explicitModel = partial?.model?.trim();
  const base = defaultOllamaConfig();
  return {
    host: normalizeOllamaHost(explicitHost || base.host),
    model: explicitModel || base.model,
    allowPaidApis: false,
  };
}

/** Local Ollama only. Paid and non-local hosts throw and do not fetch. */
export function assertMusicDraftLocal(partial?: Partial<OllamaConfig>): OllamaConfig {
  const cfg = resolveMusicDraftConfig(partial);
  const decision = assertLocalSpendOnly(false);
  const local = isLocalOllamaHost(cfg.host) && !isPaidProviderHost(cfg.host);
  if (!local) {
    const reason = decision.ok ? 'Music release drafts stay on local Ollama.' : decision.reason;
    throw new Error(`${reason} Refusing ${cfg.host}.`);
  }
  if (!cfg.model) throw new Error('JEWBOT_MODEL is empty.');
  assertOllamaAllowed(cfg);
  return cfg;
}

export function draftPrompt(release: MusicRelease): string {
  const lines = release.tracks.map((track, index) => {
    const credit = track.artist ? ` (${track.artist})` : '';
    return `${index + 1}. ${track.title}${credit}`;
  });
  const week = release.week ? [`Week: ${release.week}`] : [];
  return [
    'Draft short release notes for this weekly album.',
    'Use only the title, artist, and track names below.',
    'Write 2 to 4 sentences a listener could read.',
    'Do not claim the album was uploaded, pitched, or paid for.',
    'Do not invent store links, prices, or login steps.',
    '',
    `Album: ${release.title}`,
    `Artist: ${release.artist}`,
    ...week,
    'Tracks:',
    ...(lines.length ? lines : ['(no tracks listed)']),
  ].join('\n');
}

/** Ask local Ollama for notes. The caller stores the text and does not mark the release done. */
export async function draftReleaseNotes(
  release: MusicRelease,
  partial?: Partial<OllamaConfig>,
): Promise<string> {
  const cfg = assertMusicDraftLocal(partial);
  const text = (await chatOnce([{ role: 'user', content: draftPrompt(release) }], cfg)).trim();
  if (!text) throw new Error('Local Ollama returned empty release notes.');
  return text.length > DRAFT_CHARS ? `${text.slice(0, DRAFT_CHARS)}…` : text;
}
