/**
 * Ctrl/Cmd+K inline edit. The selection and prompt go to local Ollama.
 * The result is a diff. Nothing is written until Accept.
 */

import { createTwoFilesPatch } from 'diff';
import type { FileWorkspace } from '../files';
import { assertLocalSpendOnly } from '../safety';
import { chatOnce } from '../llm/ollama';
import { assertRoutableOllamaHost } from '../llm/route';

export interface InlineProposal {
  path: string;
  original: string;
  proposed: string;
  unifiedDiff: string;
  replacement: string;
}

export async function proposeInlineEdit(options: {
  path: string;
  fileText: string;
  selection: string;
  prompt: string;
  host?: string;
}): Promise<InlineProposal> {
  const selection = options.selection;
  if (!selection.trim()) throw new Error('Select code before asking for an inline edit.');
  const at = options.fileText.indexOf(selection);
  if (at < 0) throw new Error('The selection is not in the file.');
  const host = assertRoutableOllamaHost(options.host || 'http://127.0.0.1:11434');
  const decision = assertLocalSpendOnly(false);
  if (decision.ok) throw new Error('Inline edit keeps the spend gate closed.');
  const replacement = (
    await chatOnce(
      [
        { role: 'system', content: 'Return only the replacement for the selected code. Do not wrap it in markdown.' },
        { role: 'user', content: `Instruction: ${options.prompt}\n\nSelection:\n${selection}` },
      ],
      { host, model: process.env.JEWBOT_MODEL || 'qwen2.5-coder:7b', allowPaidApis: false, allowPrivateLan: true },
    )
  ).trim();
  const proposed = options.fileText.slice(0, at) + replacement + options.fileText.slice(at + selection.length);
  const display = options.path;
  return {
    path: display,
    original: options.fileText,
    proposed,
    replacement,
    unifiedDiff: createTwoFilesPatch(display, display, options.fileText, proposed, 'current', 'inline', { context: 2 }),
  };
}

export async function acceptInline(files: FileWorkspace, proposal: InlineProposal): Promise<void> {
  const preview = await files.proposeEdit(proposal.path, proposal.proposed);
  if (!preview.unchanged) await files.applyEdit(preview, true);
}

export function rejectInline(proposal: InlineProposal): InlineProposal {
  return proposal;
}
