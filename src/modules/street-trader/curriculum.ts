/**
 * Local retrieval over the curriculum markdown that ships with this module.
 * Embeddings go through the M11 helpers (nomic-embed-text on local Ollama).
 * If that call fails, ranking falls back to keywords. Nothing is fetched from Drive.
 */

import * as fs from 'fs';
import * as path from 'path';
import { cosine, embedTexts, EMBED_MODEL } from '../semantic';
import { STREET_DISCLAIMER } from './prompts';

const LOCAL_EMBED_HOST = 'http://127.0.0.1:11434';

export interface CurriculumSection {
  file: string;
  heading: string;
  body: string;
}

export interface CurriculumHit {
  section: CurriculumSection;
  score: number;
  mode: 'embedding' | 'keyword';
}

export interface TeachResult {
  question: string;
  heading: string;
  file: string;
  mode: 'embedding' | 'keyword';
  disclaimer: string;
  text: string;
}

export type CurriculumEmbed = (options: { host: string; input: string[]; model?: string }) => Promise<number[][]>;

const BOOSTS: Array<{ re: RegExp; heading: RegExp; weight: number }> = [
  { re: /position siz|how many shares|1% rule|\bshares\b/, heading: /^MODULE 1\b/, weight: 24 },
  { re: /2:1|2 to 1|reward-to-risk|walk away|daily stop|expectancy/, heading: /^MODULE 2\b/, weight: 24 },
  { re: /\bcandle\b|support|resistance|\bfloor\b|\bceiling\b|\bvolume\b/, heading: /^MODULE 3\b/, weight: 18 },
  { re: /\bscam\b|guaranteed|signal group|pump-and-dump|pump and dump/, heading: /^MODULE 4\b/, weight: 24 },
  { re: /paper trade|while driving|hands-free|\bjournal\b|10:00/, heading: /^MODULE 5\b/, weight: 16 },
];

let cached: CurriculumSection[] | undefined;

export function curriculumDir(): string {
  return path.join(__dirname, 'curriculum');
}

export function loadCurriculum(): CurriculumSection[] {
  if (cached) return cached;
  const dir = curriculumDir();
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  const sections: CurriculumSection[] = [];
  for (const file of names) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const match = raw.match(/^##\s+(.+)$/m);
    const heading = (match?.[1] || file.replace(/\.md$/, '')).trim();
    sections.push({ file, heading, body: raw });
  }
  cached = sections;
  return sections;
}

function tokens(question: string): string[] {
  const found = question.toLowerCase().match(/[a-z0-9%:+-]+/g) || [];
  return found.filter((word) => word.length > 2 || word === '1%' || word === '2:1');
}

export function keywordScore(question: string, section: CurriculumSection): number {
  const q = question.toLowerCase();
  const heading = section.heading.toLowerCase();
  const body = section.body.toLowerCase();
  let score = 0;
  for (const word of tokens(question)) {
    if (heading.includes(word)) score += 6;
    const hits = body.split(word).length - 1;
    score += Math.min(Math.max(hits, 0), 6);
  }
  for (const boost of BOOSTS) {
    if (boost.re.test(q) && boost.heading.test(section.heading)) score += boost.weight;
  }
  return score;
}

function bestKeyword(question: string, sections: CurriculumSection[]): CurriculumHit {
  let pick = sections[0];
  let score = -1;
  for (const section of sections) {
    const next = keywordScore(question, section);
    if (next > score) {
      score = next;
      pick = section;
    }
  }
  return { section: pick, score, mode: 'keyword' };
}

function rankedEmbeddings(questionVector: number[], rows: number[][], sections: CurriculumSection[]): CurriculumHit | null {
  let best = -1;
  let second = -1;
  let pick = 0;
  rows.forEach((vector, index) => {
    const score = cosine(questionVector, vector);
    if (score > best) {
      second = best;
      best = score;
      pick = index;
    } else if (score > second) {
      second = score;
    }
  });
  if (best <= 0 || best - second < 0.02) return null;
  return { section: sections[pick], score: best, mode: 'embedding' };
}

export async function retrieveCurriculum(
  question: string,
  options?: { embed?: CurriculumEmbed | null; host?: string },
): Promise<CurriculumHit> {
  const q = question.trim();
  if (!q) throw new Error('A curriculum question is required.');
  const sections = loadCurriculum();
  if (!sections.length) throw new Error('The Street Trader curriculum files are missing.');
  const keyword = bestKeyword(q, sections);
  if (options?.embed === null) return keyword;
  const embed = options?.embed || embedTexts;
  try {
    const input = [q, ...sections.map((section) => `${section.heading}\n${section.body}`.slice(0, 2000))];
    const vectors = await embed({
      host: options?.host || LOCAL_EMBED_HOST,
      input,
      model: EMBED_MODEL,
    });
    const embedded = rankedEmbeddings(vectors[0] || [], vectors.slice(1), sections);
    return embedded || keyword;
  } catch {
    return keyword;
  }
}

export async function teachFromCurriculum(
  question: string,
  options?: { embed?: CurriculumEmbed | null; host?: string },
): Promise<TeachResult> {
  const hit = await retrieveCurriculum(question, options);
  const excerpt = hit.section.body.replace(/^##[^\n]*\n/, '').trim().slice(0, 700);
  const text = [
    STREET_DISCLAIMER,
    '',
    `Cited section: ${hit.section.heading}`,
    `Source file: curriculum/${hit.section.file}`,
    '',
    excerpt,
    '',
    'Education only. This is not a promise of profit, not a ticker, and not an order.',
  ].join('\n');
  return {
    question: question.trim(),
    heading: hit.section.heading,
    file: hit.section.file,
    mode: hit.mode,
    disclaimer: STREET_DISCLAIMER,
    text,
  };
}
