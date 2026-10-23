/**
 * M4 smoke: gitignore-aware project index, secret/binary skips, path jail,
 * find_files / search_context, and a scripted agent turn. No network. No paid APIs.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer, formatFindResult, formatSearchResult } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { OllamaConfig } from '../src/modules/llm';
import { defaultSshManager } from '../src/modules/ssh';
import { defaultTerminal } from '../src/modules/terminal';

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

const localCfg: OllamaConfig = {
  host: 'http://127.0.0.1:11434',
  model: 'test-model',
  allowPaidApis: false,
};

const SECRET = 'CANARY_SECRET_m4_9f3a';
const OUTSIDE = 'OUTSIDE_CANARY_m4_b7c2';
const NESTED = 'NESTED_SKIP_CANARY_m4';
const DEBUG_LOG = 'DEBUG_LOG_CANARY_m4';
const KEEP_LOG = 'KEEP_LOG_CANARY_m4';
const IGNORED_DIR = 'IGNORED_DIR_CANARY_m4';
const NM = 'NM_CANARY_m4';
const DIST = 'DIST_CANARY_m4';
const BINARY = 'BINARY_CANARY_m4';
const PEM = 'PEM_CANARY_m4';
const MARKER = 'CONTEXT_INDEXER_MARKER';

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

async function writeFile(abs: string, text: string) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
}

async function testIndex() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m4-'));
  const root = path.join(parent, 'proj');
  try {
    await fs.mkdir(root);
    await fs.writeFile(path.join(parent, 'outside.txt'), `${OUTSIDE}\n`);
    await fs.writeFile(
      path.join(root, '.gitignore'),
      'secret.env\nignored/\n*.log\n!keep.log\n',
    );
    await writeFile(path.join(root, 'hello.txt'), 'hello from jewbot\n');
    await writeFile(path.join(root, 'README.md'), '# Demo\n\nA tiny project.\n');
    await writeFile(
      path.join(root, 'src', 'app.ts'),
      `export class ContextIndexer {\n  marker() { return '${MARKER}'; }\n}\n`,
    );
    await writeFile(path.join(root, 'src', '.gitignore'), 'generated/\n');
    await writeFile(path.join(root, 'src', 'generated', 'skip.ts'), `export const skip = '${NESTED}';\n`);
    await writeFile(path.join(root, '.env'), `${SECRET}=1\n`);
    await writeFile(path.join(root, '.env.local'), `${SECRET}_LOCAL=1\n`);
    await writeFile(path.join(root, 'sub', '.env.local'), `${SECRET}_NESTED=1\n`);
    await writeFile(path.join(root, '.env.example'), 'API_KEY=\nEXAMPLE_ONLY\n');
    await writeFile(path.join(root, 'secret.env'), `${SECRET}_FILE=1\n`);
    await writeFile(path.join(root, 'id_ed25519'), `${PEM}_KEY\n`);
    await writeFile(path.join(root, 'certs', 'dev.pem'), `${PEM}\n`);
    await writeFile(path.join(root, 'credentials.json'), `{"token":"${SECRET}_CRED"}\n`);
    await writeFile(path.join(root, 'ignored', 'nope.txt'), `${IGNORED_DIR}\n`);
    await writeFile(path.join(root, 'debug.log'), `${DEBUG_LOG}\n`);
    await writeFile(path.join(root, 'keep.log'), `${KEEP_LOG}\n`);
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), `module.exports = '${NM}';\n`);
    await writeFile(path.join(root, 'dist', 'bundle.js'), `console.log('${DIST}');\n`);
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git', 'config'), 'git\n');
    await fs.writeFile(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'assets', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
    await fs.writeFile(path.join(root, 'model.gguf'), Buffer.from([0, 1, 2, 3, 4]));
    await fs.writeFile(
      path.join(root, 'notes.bin.txt'),
      Buffer.concat([Buffer.from(`${BINARY}\n`), Buffer.from([0]), Buffer.from('tail\n')]),
    );
    await fs.symlink(path.join(parent, 'outside.txt'), path.join(root, 'leak.txt'));
    await fs.symlink(parent, path.join(root, 'parent-link'));
    await fs.symlink(path.join(root, 'hello.txt'), path.join(root, 'link-hello.txt'));
    await fs.symlink('/etc/passwd', path.join(root, 'escape.txt'));

    for (let i = 0; i < 120; i++) {
      const name = `f${String(i).padStart(3, '0')}.txt`;
      await writeFile(path.join(root, 'bulk', name), `bulk ${i}\n`);
    }

    const indexer = new ContextIndexer(root);
    const summary = await indexer.getProjectSummary();
    const realRoot = await fs.realpath(root);
    expect(summary.root === realRoot, `root jail ${summary.root}`);
    expect(summary.files.includes('hello.txt'), 'indexes hello.txt');
    expect(summary.files.includes('src/app.ts'), 'indexes nested source');
    expect(summary.files.includes('README.md'), 'indexes README');
    expect(summary.files.includes('.env.example'), 'keeps .env.example');
    expect(summary.files.includes('.gitignore'), 'indexes .gitignore');
    expect(summary.files.includes('keep.log'), 'honors gitignore negation');
    expect(summary.files.includes('link-hello.txt'), 'indexes in-project file symlink');
    expect(summary.files.includes('src/.gitignore'), 'indexes nested gitignore file');
    expect(summary.fileCount === summary.files.length || summary.fileCount > summary.files.length, 'fileCount covers the walk');
    expect(summary.fileCount > 100, `indexed the bulk files (${summary.fileCount})`);

    const banned = [
      '.env',
      '.env.local',
      'sub/.env.local',
      'secret.env',
      'id_ed25519',
      'certs/dev.pem',
      'credentials.json',
      'ignored/nope.txt',
      'debug.log',
      'node_modules/pkg/index.js',
      'dist/bundle.js',
      '.git/config',
      'logo.png',
      'assets/icon.png',
      'model.gguf',
      'leak.txt',
      'escape.txt',
      'parent-link',
      'outside.txt',
      'src/generated/skip.ts',
    ];
    for (const rel of banned) {
      expect(!summary.files.includes(rel), `index included ${rel}`);
    }
    expect(!summary.tree.includes('node_modules/'), 'tree hides node_modules');
    expect(summary.tree.includes('src/'), 'tree shows src');
    expect(summary.tree.includes('…'), 'tree collapses the bulk directory');
    expect(!summary.tree.includes('f119.txt'), 'tree does not list every bulk file');
    expect(summary.topLevel.includes('src/'), 'top-level has src');
    expect(summary.languages.some((item) => item.ext === '.ts' && item.count >= 1), 'counts .ts files');

    const ts = await indexer.findFiles('*.ts');
    expect(ts.matches.includes('src/app.ts'), `glob *.ts → ${ts.matches.join(',')}`);
    expect(!ts.matches.includes('src/generated/skip.ts'), 'glob skips nested gitignore');
    expect((await indexer.findFiles('src/**/*.ts')).matches.includes('src/app.ts'), 'glob src/**/*.ts');
    expect((await indexer.findFiles('app.ts')).matches.includes('src/app.ts'), 'basename query');
    expect((await indexer.findFiles('no-such-file-m4')).matches.length === 0, 'empty find');
    expect((await indexer.findFiles('../etc/passwd')).matches.length === 0, 'find does not climb out');
    expect((await indexer.findFiles('')).error?.includes('requires'), 'find requires a query');

    const hit = await indexer.searchContext('ContextIndexer');
    expect(hit.hits.some((row) => row.path === 'src/app.ts' && row.line === 1), `search hit ${JSON.stringify(hit.hits)}`);
    expect(hit.hits[0]?.excerpt.includes('ContextIndexer'), 'excerpt has the match');
    const marker = await indexer.searchContext(MARKER);
    expect(marker.hits.some((row) => row.path === 'src/app.ts'), 'search finds the marker');
    expect(formatSearchResult(marker).includes('src/app.ts'), 'format search');

    const secretHit = await indexer.searchContext(SECRET);
    expect(secretHit.hits.length === 0, `secret leaked via search ${JSON.stringify(secretHit.hits)}`);
    const outsideHit = await indexer.searchContext(OUTSIDE);
    expect(outsideHit.hits.length === 0, 'outside symlink content was searched');
    const nestedHit = await indexer.searchContext(NESTED);
    expect(nestedHit.hits.length === 0, 'nested gitignore content was searched');
    const debugHit = await indexer.searchContext(DEBUG_LOG);
    expect(debugHit.hits.length === 0, 'ignored log was searched');
    const keepHit = await indexer.searchContext(KEEP_LOG);
    expect(keepHit.hits.some((row) => row.path === 'keep.log'), 'negated log is searchable');
    const binaryHit = await indexer.searchContext(BINARY);
    expect(binaryHit.hits.length === 0, 'null-byte file contents were searched');
    const example = await indexer.searchContext('EXAMPLE_ONLY');
    expect(example.hits.some((row) => row.path === '.env.example'), '.env.example is searchable');

    await expectThrow(() => indexer.searchContext('token', { path: '.env' }), /secret path/i, 'search refuses .env');
    await expectThrow(
      () => indexer.searchContext('token', { path: 'foo/../.env' }),
      /secret path/i,
      'search refuses normalized .env',
    );
    await expectThrow(
      () => indexer.searchContext('token', { path: '../outside.txt' }),
      /escapes project root/i,
      'search refuses parent path',
    );
    await expectThrow(
      () => indexer.searchContext('token', { path: '/etc/passwd' }),
      /escapes project root/i,
      'search refuses absolute path',
    );
    await expectThrow(
      () => indexer.searchContext('token', { path: 'node_modules' }),
      /ignored path/i,
      'search refuses node_modules',
    );
    await expectThrow(
      () => indexer.searchContext('token', { path: 'src/generated/skip.ts' }),
      /ignored path/i,
      'search refuses nested ignore',
    );

    const scoped = await indexer.searchContext(MARKER, { path: 'src' });
    expect(scoped.hits.length === 1 && scoped.hits[0].path === 'src/app.ts', 'path filter limits search');
    const missed = await indexer.searchContext(MARKER, { path: 'README.md' });
    expect(missed.hits.length === 0, 'path filter can exclude a hit');

    const limited = await indexer.searchContext('bulk', { limit: 1 });
    expect(limited.hits.length === 1 && limited.truncated, 'search limit sets truncated');

    const prompt = await indexer.buildTurnContext('Where is ContextIndexer defined in src/app.ts?');
    expect(prompt.includes('src/app.ts'), 'turn context names the file');
    expect(prompt.includes('ContextIndexer'), 'turn context excerpts the symbol');
    expect(prompt.includes(MARKER), 'turn context includes the marker line');
    expect(prompt.length < 9000, `turn context is compact (${prompt.length})`);
    expect(!prompt.includes('f119.txt'), 'turn context does not dump bulk files');
    for (const canary of [SECRET, OUTSIDE, NESTED, DEBUG_LOG, IGNORED_DIR, NM, DIST, BINARY, PEM]) {
      expect(!prompt.includes(canary), `turn context leaked ${canary}`);
    }
    expect(formatFindResult(ts).includes('src/app.ts'), 'format find');

    const fileRoot = path.join(root, 'hello.txt');
    await expectThrow(() => new ContextIndexer(fileRoot).summarize(), /not a directory/i, 'file root rejected');
    await expectThrow(
      () => new ContextIndexer(path.join(root, 'missing-dir')).getProjectSummary(),
      /not a directory/i,
      'missing root rejected',
    );

    const bare = path.join(parent, 'bare');
    await fs.mkdir(bare);
    await writeFile(path.join(bare, 'hello.txt'), 'plain\n');
    await writeFile(path.join(bare, '.env'), `${SECRET}_BARE\n`);
    await writeFile(path.join(bare, 'node_modules', 'x.js'), NM);
    await writeFile(path.join(bare, 'dist', 'a.js'), DIST);
    const bareSummary = await new ContextIndexer(bare).summarize();
    expect(bareSummary.files.includes('hello.txt'), 'default index keeps hello');
    expect(!bareSummary.files.some((rel) => rel === '.env' || rel.startsWith('node_modules/') || rel.startsWith('dist/')), 'defaults skip secrets and vendor');
    const barePrompt = await new ContextIndexer(bare).buildTurnContext('read hello.txt');
    expect(barePrompt.includes('hello.txt'), 'bare prompt lists hello');
    expect(!barePrompt.includes(`${SECRET}_BARE`), 'bare prompt skips .env');
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

async function testAgent() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m4-agent-'));
  const root = path.join(parent, 'proj');
  try {
    await fs.mkdir(root);
    await fs.writeFile(path.join(parent, 'outside.txt'), `${OUTSIDE}\n`);
    await fs.writeFile(path.join(root, '.gitignore'), 'secret.env\n');
    await writeFile(path.join(root, 'src', 'app.ts'), `export class ContextIndexer {\n  marker() { return '${MARKER}'; }\n}\n`);
    await writeFile(path.join(root, '.env'), `${SECRET}=1\n`);
    await fs.symlink(path.join(parent, 'outside.txt'), path.join(root, 'leak.txt'));

    const script = [
      '{"tool":"get_project_summary","args":{}}',
      '{"tool":"find_files","args":{"query":"*.ts"}}',
      '{"tool":"search_files","args":{"query":"ContextIndexer","path":"src"}}',
      'FINAL: ContextIndexer is in src/app.ts',
    ];
    let step = 0;
    let firstBody = '';
    const original = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!firstBody && init?.body) firstBody = String(init.body);
      const content = script[Math.min(step, script.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    try {
      const agent = new AgentLoop({
        files: new FileWorkspace(root),
        terminal: defaultTerminal,
        ssh: defaultSshManager,
        context: new ContextIndexer(root),
        llm: localCfg,
        maxSteps: 6,
      });
      const result = await agent.run('Where is ContextIndexer defined?');
      expect(result.status === 'done', `agent status ${result.status} ${result.blockReason ?? ''}`);
      expect(result.finalText === 'ContextIndexer is in src/app.ts', `final ${result.finalText}`);
      const tools = result.steps.map((item) => item.tool?.name).filter(Boolean);
      expect(
        tools[0] === 'get_project_summary' && tools[1] === 'find_files' && tools[2] === 'search_files',
        `tools ${tools.join(',')}`,
      );
      const summaryObs = result.steps[0].observation || '';
      expect(summaryObs.includes('src/app.ts') || summaryObs.includes('src/'), `summary obs ${summaryObs}`);
      expect(!summaryObs.includes(SECRET), 'summary observation leaked .env');
      expect(!summaryObs.includes(OUTSIDE), 'summary observation leaked outside file');
      const found = result.steps[1].observation || '';
      expect(found.includes('src/app.ts'), `find obs ${found}`);
      const searched = result.steps[2].observation || '';
      expect(searched.includes('src/app.ts') && searched.includes('ContextIndexer'), `search obs ${searched}`);
      expect(!searched.includes(SECRET) && !searched.includes(OUTSIDE), 'search observation leaked');
      expect(firstBody.includes('src/app.ts'), 'prompt names the project file');
      expect(firstBody.includes('ContextIndexer'), 'prompt includes the excerpt');
      expect(!firstBody.includes(SECRET), 'prompt leaked secret');
      expect(!firstBody.includes(OUTSIDE), 'prompt leaked outside canary');
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

async function main() {
  await testIndex();
  await testAgent();
  console.log('smoke-m4: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
