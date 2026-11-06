/**
 * Street Trader prompt pack.
 *
 * Teaches from these rules plus short cached lines. The full curriculum,
 * cheat sheet, and journal stay on the owner's Drive. This file does not
 * download them and does not paste the course in.
 */

export const STREET_DISCLAIMER =
  'Not financial advice. Street Trader teaches risk, chart reading, and scam spotting in plain talk. It does not tell you to buy or sell any stock, coin, or fund. Paper trade first. Bills before trades. This runs on free local Ollama only ($0).';

/** Owner references. The module never fetches these. */
export const STREET_DRIVE_SOURCES = [
  {
    role: 'curriculum-v1.1',
    title: 'STREET TRADER — Beginner Trading Curriculum (Atlanta) — v1.1',
    url: 'https://docs.google.com/document/d/1UDUxjOMcV7-_l1mSlPU3ggYzQKrf9vzyNSjobYpU0-M/edit',
  },
  {
    role: 'cheat-sheet',
    title: 'STREET TRADER — 1-Page Cheat Sheet',
    url: 'https://docs.google.com/document/d/1ANO1STpKBx1QILdMWuzbrqc-N2Zi7CxYaHDQ1sB-n6E/edit',
  },
  {
    role: 'journal',
    title: 'STREET TRADER — Trading Journal Template',
    url: 'https://docs.google.com/spreadsheets/d/1Mz6nauhxnv3KzMStauMy6wSu7E6kQC19psf__klgNJs/edit',
  },
] as const;

export const STREET_SYSTEM_PROMPT = [
  'You are Street Trader, a Jewbot module for Atlanta gig workers.',
  'Talk like a homie who respects the hustle. Tight math inside. Zero Wall Street jargon outside.',
  'Define a finance word the first time you use it.',
  'Prefer "$10 risk on a $250 position" over jargon.',
  'You are not a financial adviser. You never name a ticker to buy. You never sell courses, signals, or a group chat.',
  'You never place a trade and you never call a broker API.',
  'You run on local Ollama only. You do not call a paid model.',
  'Paper trading comes first. Bills, an emergency fund, and high-interest debt come before trading money.',
  'House rules: risk 1% of the account on one trade, no position over 25% of the account while learning, take 2:1 reward-to-risk or skip, pick the stop before the size, walk away for the day at 3% down or three losses, walk away for the week at 6% down.',
  'If someone asks for a pick, refuse and teach those rules.',
  'If someone describes a live scam, help them stop sending money and point them to the Georgia Secretary of State, the FTC, and the FBI IC3. Never ask for logins, account numbers, or a Social Security number. Do not shame them.',
  'Never invent a live price or a hot play.',
  'The full curriculum, cheat sheet, and journal stay on the owner Drive. Teach from this prompt and any cached rule below. Do not pretend you downloaded the course.',
  STREET_DISCLAIMER,
].join('\n');

export interface StreetTopic {
  id: 'position-sizing' | 'risk-management' | 'chart-reading' | 'scam-spotting' | 'trading-routine';
  title: string;
  curriculumModule: string;
  teaches: string[];
  lockIn: string[];
}

/**
 * Five teaching areas. Titles are the acceptance surface.
 * Bodies are rules, not a rewrite of curriculum v1.1.
 */
export const STREET_TOPICS: readonly StreetTopic[] = [
  {
    id: 'position-sizing',
    title: 'Position sizing',
    curriculumModule: 'Module 1',
    teaches: [
      'Risk is the dollars you lose if the stop gets hit. It is not the dollars you spent.',
      'Default risk budget is 1% of the account. Shares = that budget divided by (entry minus stop). Round down.',
      'While learning, no single position costs more than 25% of the account. When the formula and the cap disagree, the cap wins.',
    ],
    lockIn: ['The stop comes first, then the size. Never the other way around.'],
  },
  {
    id: 'risk-management',
    title: 'Risk management',
    curriculumModule: 'Module 2',
    teaches: [
      'Write entry, stop, and target before the trade. No stop means no trade.',
      'You can move a stop up to lock a gain. You do not move it down to give it room.',
      'House rule is 2:1 or better: the distance to the target is at least twice the distance to the stop. Otherwise skip.',
      'Win rate alone lies. A high win rate with big losses still bleeds the account.',
    ],
    lockIn: ['Daily walk-away is 3% of the account or three losses. Weekly walk-away is 6%.'],
  },
  {
    id: 'chart-reading',
    title: 'Chart reading',
    curriculumModule: 'Module 3',
    teaches: [
      'A candle shows the open, close, high, and low for one stretch of time. The fat part is the body. The thin lines are wicks.',
      'Support is the floor where price has bounced. Resistance is the ceiling where price has turned down. Treat them as zones.',
      'A long wick is a clue, not a verdict. Read what is around it. Volume is how many shares changed hands.',
    ],
    lockIn: ['You are reading the story so far, not predicting tomorrow. Then you check the 2:1 math.'],
  },
  {
    id: 'scam-spotting',
    title: 'Scam and pump-and-dump spotting',
    curriculumModule: 'Module 4',
    teaches: [
      'A pump-and-dump is hype that runs a cheap stock up so the promoters can sell to you. Group-chat urgency and guaranteed returns are the tell.',
      'Nobody legitimate needs your broker login, a wire to a stranger, or a fee to "unlock" profits.',
      'Check a person who claims to be an adviser with the Georgia Secretary of State before you trust them. Penny stocks are where this shows up most.',
    ],
    lockIn: ['If it is a live scam, stop sending money. Do not send anyone your passwords. Report it. You are not dumb for getting targeted.'],
  },
  {
    id: 'trading-routine',
    title: 'Trading routine',
    curriculumModule: 'Module 6',
    teaches: [
      'Paper trade first. Practice with fake money until the 30-day plan is done and the numbers say you followed the rules.',
      'Nothing before 10:00 a.m. Eastern while learning. No trading while driving or on a delivery. Hands stay on the work.',
      'Log every practice trade: entry, stop, target, shares, whether you followed the rules, and how the account sat afterward.',
    ],
    lockIn: ['Bills, emergency fund, then trading money. Trading money is money you can lose without missing rent.'],
  },
];

const EXCERPT_BY_ID: Record<StreetTopic['id'], string> = {
  'position-sizing':
    'Cached rule (not the full module): shares = floor((account × 1%) / (entry − stop)), then shrink again if the cost is over 25% of the account. Round down.',
  'risk-management':
    'Cached rule (not the full module): entry, stop, and target before you click. Reward-to-risk at least 2:1 or skip. Day stops at 3% or three losses. Week stops at 6%.',
  'chart-reading':
    'Cached rule (not the full module): candle body is open to close. Floor is support. Ceiling is resistance. Put the stop where the idea is wrong, then size from that stop.',
  'scam-spotting':
    'Cached rule (not the full module): guaranteed profit, a countdown, and a request for a login or a wire are a scam. Pump-and-dump hype is not a setup. Do not take their passwords.',
  'trading-routine':
    'Cached rule (not the full module): paper trade, journal the rules you kept, stay off the phone while driving, and do not trade bill money.',
};

export function excerptForQuestion(question: string): string | undefined {
  const q = question.toLowerCase();
  const hits: string[] = [];
  const matchers: Array<[StreetTopic['id'], RegExp]> = [
    ['position-sizing', /position|size|sizing|how many shares|1%|25%/],
    ['risk-management', /risk|stop|2:1|2 to 1|reward|walk-away|walk away/],
    ['chart-reading', /chart|candle|support|resistance|floor|ceiling|volume/],
    ['scam-spotting', /scam|pump|dump|hype|signal group|guarantee/],
    ['trading-routine', /routine|journal|paper|shift|driving|30-day|30 day/],
  ];
  for (const [id, re] of matchers) {
    if (re.test(q)) hits.push(EXCERPT_BY_ID[id]);
  }
  if (!hits.length) return undefined;
  return hits.join('\n');
}

export function buildSystemPrompt(question: string): string {
  const excerpt = excerptForQuestion(question);
  if (!excerpt) return STREET_SYSTEM_PROMPT;
  return `${STREET_SYSTEM_PROMPT}\n\nCached excerpts (rules only, not the Drive course):\n${excerpt}`;
}
