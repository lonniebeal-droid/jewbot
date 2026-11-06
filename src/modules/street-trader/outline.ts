/**
 * street_outline — local lesson map. No model call. No Drive download.
 */

import { STREET_DISCLAIMER, STREET_DRIVE_SOURCES, STREET_TOPICS, type StreetTopic } from './prompts';

export interface StreetOutline {
  module: 'street-trader';
  spend: 'local-only';
  tool: 'street_outline';
  disclaimer: string;
  topics: StreetTopic[];
  /** Plain-text map. Acceptance checks read this. */
  text: string;
  sources: typeof STREET_DRIVE_SOURCES;
}

export function streetOutline(topicId?: string): StreetOutline {
  const topics = selectTopics(topicId);
  const lines = [
    STREET_DISCLAIMER,
    '',
    'Street Trader lesson map. The full course stays on the owner Drive. This is the local outline.',
    '',
  ];
  for (const topic of topics) {
    lines.push(`${topic.curriculumModule} — ${topic.title}`);
    for (const line of topic.teaches) lines.push(`- ${line}`);
    for (const line of topic.lockIn) lines.push(`- Lock it in: ${line}`);
    lines.push('');
  }
  lines.push('Sources (owner Drive, not downloaded by this module):');
  for (const source of STREET_DRIVE_SOURCES) lines.push(`- ${source.role}: ${source.title}`);
  return {
    module: 'street-trader',
    spend: 'local-only',
    tool: 'street_outline',
    disclaimer: STREET_DISCLAIMER,
    topics: topics.map((topic) => ({ ...topic, teaches: [...topic.teaches], lockIn: [...topic.lockIn] })),
    text: lines.join('\n').trim(),
    sources: STREET_DRIVE_SOURCES,
  };
}

function selectTopics(topicId?: string): StreetTopic[] {
  if (!topicId || !topicId.trim()) return [...STREET_TOPICS];
  const id = topicId.trim().toLowerCase();
  const found = STREET_TOPICS.filter((topic) => topic.id === id || topic.title.toLowerCase() === id);
  if (!found.length) {
    const known = STREET_TOPICS.map((topic) => topic.id).join(', ');
    throw new Error(`Unknown Street Trader topic "${topicId}". Known: ${known}.`);
  }
  return [...found];
}
