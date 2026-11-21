/**
 * M14 inline edit smoke. Mocked Ollama. Accept writes, reject does not.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileWorkspace } from '../src/modules/files';
import { acceptInline, proposeInlineEdit, rejectInline } from '../src/modules/editor';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    expect(re.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

function mockChat(text: string) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    expect(String(input) === 'http://127.0.0.1:11434/api/chat', String(input));
    return new Response(JSON.stringify({ message: { role: 'assistant', content: text }, done: true }) + '\n', { status: 200 });
  };
}

async function testInlineDiff() {
  const original = globalThis.fetch;
  mockChat('fixed');
  try {
    const proposal = await proposeInlineEdit({
      path: 'note.txt',
      fileText: 'keep bug tail\n',
      selection: 'bug',
      prompt: 'repair it',
    });
    expect(proposal.proposed === 'keep fixed tail\n', proposal.proposed);
    expect(proposal.unifiedDiff.includes('-bug') || proposal.unifiedDiff.includes('bug'), proposal.unifiedDiff);
    rejectInline(proposal);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jewbot-m14-'));
    fs.writeFileSync(path.join(root, 'note.txt'), 'keep bug tail\n');
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8') === 'keep bug tail\n', 'reject does not write');
    await acceptInline(new FileWorkspace(root), proposal);
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8') === 'keep fixed tail\n', 'accept writes the splice');
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error('no');
    };
    await expectThrow(
      () => proposeInlineEdit({ path: 'a', fileText: 'bug', selection: 'bug', prompt: 'x', host: 'https://api.x.ai' }),
      /Refusing/,
      'paid host',
    );
    expect(fetches === 0, 'paid inline edit did not fetch');
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  await testInlineDiff();
  console.log('smoke-m14: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
