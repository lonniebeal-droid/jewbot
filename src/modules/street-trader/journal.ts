/**
 * street_journal_prompt — reflection questions for the owner journal.
 * Does not write the sheet and does not read account rows.
 */

import { STREET_DISCLAIMER } from './prompts';

export type JournalKind = 'trade' | 'session' | 'week';

export interface JournalPrompt {
  kind: JournalKind;
  prompts: string[];
}

export interface StreetJournal {
  module: 'street-trader';
  spend: 'local-only';
  tool: 'street_journal_prompt';
  disclaimer: string;
  /** The sheet lives on the owner Drive. This tool only suggests what to write. */
  writesSheet: false;
  prompts: JournalPrompt[];
  text: string;
}

const TRADE: string[] = [
  'Is this a paper trade, and are rent and the car note already covered?',
  'Write the entry, the stop, and the target before the fill. What are the three numbers?',
  'How many shares did the 1% rule allow, and did the 25% cap shrink that? Did you round down?',
  'What was the planned reward-to-risk? If it is under 2:1, the plan is to skip.',
  'Followed rules: Y or N. If N, which rule broke? No shame, just the fact.',
  'In plain words, what did price do after you were in?',
  'After the exit, what is the dollar result and the R multiple (the result measured in the dollars you planned to risk)?',
];

const SESSION: string[] = [
  'Did you stop for the day at 3% down or three losses, whichever came first?',
  'Did you stay out before 10:00 a.m. Eastern, and off the chart while driving?',
  'Did any setup look like a pump or a group-chat hurry-up? Name the red flag and the skip.',
  'What will you write in the notes column so tomorrow-you can see the rule, not the feeling?',
];

const WEEK: string[] = [
  'Are you inside the 6% weekly walk-away, or did you already stop?',
  'How far is the account from its peak (the drawdown), and is rent still untouched?',
  'One habit to repeat next week, and one habit to drop. Not a ticker.',
  'Count the trades where Followed rules was N. What is the one rule that slipped most?',
];

const BY_KIND: Record<JournalKind, string[]> = {
  trade: TRADE,
  session: SESSION,
  week: WEEK,
};

export function streetJournalPrompt(kind?: JournalKind): StreetJournal {
  const kinds: JournalKind[] = kind ? [kind] : ['trade', 'session', 'week'];
  if (kind && !BY_KIND[kind]) {
    throw new Error('Journal kind must be trade, session, or week.');
  }
  const prompts = kinds.map((name) => ({ kind: name, prompts: [...BY_KIND[name]] }));
  const lines = [STREET_DISCLAIMER, '', 'Journal prompts. Write them in your own sheet. This module does not open it.', ''];
  for (const block of prompts) {
    lines.push(block.kind);
    for (const prompt of block.prompts) lines.push(`- ${prompt}`);
    lines.push('');
  }
  return {
    module: 'street-trader',
    spend: 'local-only',
    tool: 'street_journal_prompt',
    disclaimer: STREET_DISCLAIMER,
    writesSheet: false,
    prompts,
    text: lines.join('\n').trim(),
  };
}
