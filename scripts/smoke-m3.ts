/**
 * M3 smoke: jailed write_file / apply_edit, unified diff before apply, owner Accept.
 * No network. No paid APIs. Writes stay inside a temp project directory.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace, SecretPathError } from '../src/modules/files';
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

function diffLines(unified: string, prefix: '-' | '+'): string[] {
  return unified.split('\n').filter((line) => line.startsWith(prefix) && !line.startsWith(prefix + prefix + prefix));
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

const llm = { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false };

async function testEdits() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m3-'));
  const outsideName = `jewbot-m3-owned-${process.pid}.txt`;
  const outsidePath = path.join(os.tmpdir(), outsideName);
  try {
    await fs.writeFile(path.join(root, '.gitignore'), 'secret.env\nignored/\n');
    await fs.writeFile(path.join(root, 'hello.txt'), 'hello from jewbot\n');
    await fs.writeFile(path.join(root, '.env'), 'API_KEY=original-secret\n');
    await fs.writeFile(path.join(root, '.env.example'), 'API_KEY=\n');
    await fs.writeFile(path.join(root, 'secret.env'), 'TOKEN=hidden\n');
    await fs.writeFile(path.join(root, 'id_rsa'), 'PRIVATE\n');
    await fs.mkdir(path.join(root, 'certs'));
    await fs.writeFile(path.join(root, 'certs', 'server.pem'), 'PEM\n');
    await fs.mkdir(path.join(root, 'ignored'));
    await fs.writeFile(path.join(root, 'ignored', 'nope.txt'), 'nope');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'pkg.js'), 'x');
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'app.js'), 'bundle');
    await fs.writeFile(path.join(root, 'blob.bin'), 'a\0b');
    await fs.symlink('/etc/passwd', path.join(root, 'escape.txt'));
    await fs.symlink(path.join(os.tmpdir()), path.join(root, 'tmp-link'));
    await fs.symlink(path.join(root, 'hello.txt'), path.join(root, 'link-hello.txt'));

    const files = new FileWorkspace(root);
    const before = await fs.readFile(path.join(root, 'hello.txt'), 'utf8');
    const preview = await files.proposeEdit('hello.txt', 'updated from m3\n');
    expect(preview.created === false && preview.secret === false && preview.unchanged === false, 'preview flags');
    expect(preview.editId.startsWith('edit_'), `edit id ${preview.editId}`);
    expect(diffLines(preview.unifiedDiff, '-').some((line) => line.includes('hello from jewbot')), `minus ${preview.unifiedDiff}`);
    expect(diffLines(preview.unifiedDiff, '+').some((line) => line.includes('updated from m3')), `plus ${preview.unifiedDiff}`);
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === before, 'preview does not write');

    await expectThrow(() => files.applyEdit(preview, false), /confirmation/i, 'apply gated');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === before, 'declined apply does not write');
    await files.applyEdit(preview, true);
    expect((await files.read('hello.txt')) === 'updated from m3\n', 'confirmed apply');

    const undone = await files.undoEdit(preview.editId);
    expect(undone.action === 'restored' && undone.filePath === 'hello.txt', `undo ${undone.action}`);
    expect((await files.read('hello.txt')) === before, 'undo restores bytes');
    await expectThrow(() => files.undoEdit(preview.editId), /Unknown edit/, 'undo is one shot');

    const created = await files.previewEdit('notes/todo.md', { content: 'ship m3\n' });
    expect(created.created === true, 'new file flagged');
    expect(diffLines(created.unifiedDiff, '+').some((line) => line.includes('ship m3')), 'new file diff');
    await files.applyEdit(created, true);
    expect((await files.read('notes/todo.md')) === 'ship m3\n', 'created file');
    const removed = await files.undoEdit(created.editId);
    expect(removed.action === 'deleted', 'undo of create deletes');
    await expectThrow(() => fs.stat(path.join(root, 'notes', 'todo.md')), /ENOENT/, 'created file removed');

    const same = await files.proposeEdit('hello.txt', before);
    expect(same.unchanged === true, 'identical content is unchanged');

    const replaced = await files.previewEdit('hello.txt', { search: 'hello from jewbot', replace: 'replaced once' });
    expect(replaced.proposed === 'replaced once\n', `replace result ${JSON.stringify(replaced.proposed)}`);
    await expectThrow(
      () => files.previewEdit('hello.txt', { search: 'e', replace: 'E' }),
      /not unique/,
      'ambiguous search',
    );
    await expectThrow(
      () => files.previewEdit('hello.txt', { search: 'missing-token', replace: 'x' }),
      /not found/,
      'missing search',
    );
    await expectThrow(
      () => files.previewEdit('missing.txt', { search: 'a', replace: 'b' }),
      /does not exist/,
      'search on missing file',
    );
    await expectThrow(() => files.previewEdit('hello.txt', {}), /content or search/, 'empty spec');

    const raced = await files.proposeEdit('hello.txt', 'race\n');
    await fs.writeFile(path.join(root, 'hello.txt'), 'someone else\n');
    await expectThrow(() => files.applyEdit(raced, true), /changed since the diff preview/, 'stale preview');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'someone else\n', 'stale apply left the new bytes');
    await fs.writeFile(path.join(root, 'hello.txt'), before);

    await expectThrow(() => files.proposeEdit('../etc/passwd', 'x'), /escapes project root/i, 'lexical jail');
    await expectThrow(() => files.proposeEdit('/etc/passwd', 'x'), /escapes project root/i, 'absolute jail');
    await expectThrow(() => files.proposeEdit('sub/../../etc/passwd', 'x'), /escapes project root/i, 'dotdot jail');
    await expectThrow(() => files.proposeEdit('escape.txt', 'pwned'), /escapes project root/i, 'symlink file jail');
    await expectThrow(
      () => files.proposeEdit(`tmp-link/${outsideName}`, 'pwned'),
      /escapes project root/i,
      'symlink dir jail',
    );
    await expectThrow(() => fs.stat(outsidePath), /ENOENT/, 'symlink did not create an outside file');
    expect((await fs.readFile('/etc/passwd', 'utf8')).includes('root:'), 'passwd still readable and not replaced');

    const escaped = await files.proposeEdit('hello.txt', 'nope\n');
    escaped.filePath = '../outside.txt';
    await expectThrow(() => files.applyEdit(escaped, true), /escapes project root/i, 'tampered preview path');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === before, 'tampered preview did not write');

    await expectThrow(() => files.proposeEdit('.env', 'API_KEY=new\n'), /secret/i, 'secret write needs confirm');
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')) === 'API_KEY=original-secret\n', '.env untouched');
    await expectThrow(() => files.read('.env'), /secret/i, 'secret read needs confirm');
    expect((await files.read('.env', { allowSecret: true })) === 'API_KEY=original-secret\n', 'owner can open .env');

    const secretPreview = await files.proposeEdit('.env', 'API_KEY=accepted\n', { allowSecret: true });
    expect(secretPreview.secret === true, 'secret flag');
    expect(diffLines(secretPreview.unifiedDiff, '-').some((line) => line.includes('original-secret')), 'secret diff shows old to owner');
    await expectThrow(() => files.applyEdit(secretPreview, true), /secret/i, 'secret apply needs allowSecret');
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')).includes('original-secret'), 'secret not written without flag');
    await files.applyEdit(secretPreview, true, { allowSecret: true });
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')) === 'API_KEY=accepted\n', 'secret written after flag');
    expect((await files.undoEdit(secretPreview.editId)).action === 'restored', 'undo secret');
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')) === 'API_KEY=original-secret\n', 'secret undo restored');

    await expectThrow(() => files.proposeEdit('id_rsa', 'nope'), /secret/i, 'id_rsa is secret');
    await expectThrow(() => files.read('certs/server.pem'), /secret/i, 'pem is secret');
    const example = await files.proposeEdit('.env.example', 'API_KEY=example\n');
    expect(example.secret === false, '.env.example is not secret');
    await files.applyEdit(example, true);
    expect((await files.read('.env.example')) === 'API_KEY=example\n', '.env.example written');

    await expectThrow(() => files.proposeEdit('secret.env', 'x'), /gitignored|secret/i, 'gitignored name stays blocked');
    await expectThrow(() => files.proposeEdit('ignored/nope.txt', 'x'), /gitignored|secret/i, 'gitignored dir stays blocked');
    await expectThrow(() => files.proposeEdit('node_modules/pkg.js', 'x', { allowSecret: true }), /gitignored|secret/i, 'node_modules stays blocked');
    await expectThrow(() => files.read('node_modules/pkg.js', { allowSecret: true }), /gitignored|secret/i, 'node_modules read stays blocked');
    await expectThrow(() => files.proposeEdit('dist/app.js', 'x', { allowSecret: true }), /gitignored|secret/i, 'dist stays blocked');
    await expectThrow(() => files.proposeEdit('blob.bin', 'text'), /binary/i, 'binary refuse');
    expect((await fs.readFile(path.join(root, 'blob.bin'))).includes(0), 'binary untouched');

    const huge = 'x'.repeat(200_001);
    await expectThrow(() => files.proposeEdit('hello.txt', huge), /larger than/, 'size cap');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === before, 'oversize did not write');

    try {
      await files.proposeEdit('.env', 'API_KEY=nope\n');
      throw new Error('expected SecretPathError');
    } catch (err) {
      expect(err instanceof SecretPathError, 'secret error class');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outsidePath, { force: true });
  }
}

async function testAgentEdits() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jewbot-m3-agent2-'));
  const originalFetch = globalThis.fetch;
  try {
    await fs.writeFile(path.join(root, 'hello.txt'), 'hello\n');
    await fs.writeFile(path.join(root, '.env'), 'API_KEY=original-secret\n');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'pkg.js'), 'x');
    const files = new FileWorkspace(root);
    const context = new ContextIndexer(root);
    let step = 0;
    let asked = 0;

    const denyScript = [
      JSON.stringify({
        tool: 'write_file',
        args: { path: 'hello.txt', content: 'should-not-land\n', confirmed: true, approved: true, allowSecret: true },
      }),
      'FINAL: stopped',
    ];
    globalThis.fetch = async () => {
      const content = denyScript[Math.min(step, denyScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const denied = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async (req) => {
        asked += 1;
        expect(req.path === 'hello.txt', `deny path ${req.path}`);
        expect(req.secret === false, 'hello.txt is not secret');
        expect(diffLines(req.unifiedDiff, '+').some((line) => line.includes('should-not-land')), 'owner sees the diff first');
        expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'hello\n', 'file still old while the diff is showing');
        return false;
      },
    });
    const deniedResult = await denied.run('overwrite hello');
    expect(deniedResult.status === 'done', `denied status ${deniedResult.status} ${deniedResult.blockReason ?? ''}`);
    expect(asked === 1, `confirm asked once, got ${asked}`);
    const deniedObs = deniedResult.steps.map((s) => s.observation || '').join('\n');
    expect(deniedObs.includes('REJECTED'), `observation ${deniedObs}`);
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'hello\n', 'reject did not write');

    step = 0;
    const allowScript = [
      JSON.stringify({
        tool: 'apply_edit',
        args: { path: 'hello.txt', search: 'hello', replace: 'updated', confirmed: true },
      }),
      'FINAL: updated',
    ];
    globalThis.fetch = async () => {
      const content = allowScript[Math.min(step, allowScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    let appliedId = '';
    const allowed = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async () => true,
      onEditApplied: (editId) => {
        appliedId = editId;
      },
    });
    const allowedResult = await allowed.run('replace hello');
    expect(allowedResult.status === 'done', `status ${allowedResult.status} ${allowedResult.blockReason ?? ''}`);
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'updated\n', 'accepted search/replace');
    expect(appliedId.startsWith('edit_'), 'undo id recorded');
    expect((await files.undoEdit(appliedId)).action === 'restored', 'agent undo');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'hello\n', 'undo after agent apply');

    step = 0;
    const secretScript = [
      JSON.stringify({
        tool: 'write_file',
        args: { path: '.env', content: 'API_KEY=proposed\n', allowSecret: true, confirmed: true },
      }),
      'FINAL: secret left alone',
    ];
    globalThis.fetch = async () => {
      const content = secretScript[Math.min(step, secretScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    let sawSecretDiff = false;
    const secretDenied = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async (req) => {
        sawSecretDiff = req.secret === true && req.unifiedDiff.includes('original-secret');
        return false;
      },
    });
    const secretDeniedResult = await secretDenied.run('rewrite env');
    const secretObs = secretDeniedResult.steps.map((s) => s.observation || '').join('\n');
    expect(sawSecretDiff, 'owner preview includes the existing secret');
    expect(secretObs.includes('REJECTED'), `secret reject obs ${secretObs}`);
    expect(!secretObs.includes('original-secret'), 'model observation omits the existing secret');
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')) === 'API_KEY=original-secret\n', 'rejected secret write');

    step = 0;
    const secretAllow = [
      JSON.stringify({ tool: 'write_file', args: { path: '.env', content: 'API_KEY=proposed\n' } }),
      'FINAL: wrote secret',
    ];
    globalThis.fetch = async () => {
      const content = secretAllow[Math.min(step, secretAllow.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const secretOk = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async (req) => req.secret === true,
    });
    const secretOkResult = await secretOk.run('rewrite env for real');
    const secretOkObs = secretOkResult.steps.map((s) => s.observation || '').join('\n');
    expect(secretOkObs.includes('APPLIED'), `secret apply obs ${secretOkObs}`);
    expect(!secretOkObs.includes('original-secret'), 'applied observation still omits the old secret');
    expect((await fs.readFile(path.join(root, '.env'), 'utf8')) === 'API_KEY=proposed\n', 'secret written after accept');

    step = 0;
    let secretReads = 0;
    const readScript = [
      JSON.stringify({ tool: 'read_file', args: { path: '.env', allowSecret: true } }),
      'FINAL: hidden',
    ];
    globalThis.fetch = async () => {
      const content = readScript[Math.min(step, readScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const readDenied = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmSecret: async () => {
        secretReads += 1;
        return false;
      },
    });
    const readDeniedResult = await readDenied.run('read env');
    const readObs = readDeniedResult.steps.map((s) => s.observation || '').join('\n');
    expect(secretReads === 1, 'secret read asked');
    expect(readObs.includes('REFUSED'), `read obs ${readObs}`);
    expect(!readObs.includes('API_KEY=proposed') && !readObs.includes('original-secret'), 'refused read hid contents');

    step = 0;
    const readAllowScript = [
      JSON.stringify({ tool: 'read_file', args: { path: '.env' } }),
      'FINAL: saw it',
    ];
    globalThis.fetch = async () => {
      const content = readAllowScript[Math.min(step, readAllowScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const readOk = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmSecret: async (req) => req.path === '.env',
    });
    const readOkResult = await readOk.run('read env with confirm');
    expect((readOkResult.steps[0].observation || '').includes('API_KEY=proposed'), 'opened secret after confirm');

    step = 0;
    let blockedAsks = 0;
    const blockedScript = [
      JSON.stringify({ tool: 'write_file', args: { path: 'node_modules/pkg.js', content: 'pwned', allowSecret: true } }),
      'FINAL: blocked',
    ];
    globalThis.fetch = async () => {
      const content = blockedScript[Math.min(step, blockedScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const blocked = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async () => {
        blockedAsks += 1;
        return true;
      },
    });
    const blockedResult = await blocked.run('write node_modules');
    const blockedObs = blockedResult.steps.map((s) => s.observation || '').join('\n');
    expect(blockedAsks === 0, 'hard-ignored paths do not ask to accept');
    expect(blockedObs.includes('ERROR'), `blocked obs ${blockedObs}`);
    expect((await fs.readFile(path.join(root, 'node_modules', 'pkg.js'), 'utf8')) === 'x', 'node_modules untouched');

    step = 0;
    const noGateScript = [
      JSON.stringify({ tool: 'write_file', args: { path: 'hello.txt', content: 'ungated\n', confirmed: true } }),
      'FINAL: nope',
    ];
    globalThis.fetch = async () => {
      const content = noGateScript[Math.min(step, noGateScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const noGate = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
    });
    const noGateResult = await noGate.run('write without a gate');
    expect((noGateResult.steps[0].observation || '').includes('REJECTED'), 'missing gate rejects');
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'hello\n', 'missing gate did not write');

    step = 0;
    const sameScript = [
      JSON.stringify({ tool: 'write_file', args: { path: 'hello.txt', content: 'hello\n' } }),
      'FINAL: same',
    ];
    globalThis.fetch = async () => {
      const content = sameScript[Math.min(step, sameScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    let sameAsks = 0;
    const same = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async () => {
        sameAsks += 1;
        return true;
      },
    });
    const sameResult = await same.run('write the same bytes');
    expect(sameAsks === 0, 'unchanged edit does not ask');
    expect((sameResult.steps[0].observation || '').includes('UNCHANGED'), `same obs ${sameResult.steps[0].observation}`);

    const ctrl = new AbortController();
    step = 0;
    const abortScript = [
      JSON.stringify({ tool: 'write_file', args: { path: 'hello.txt', content: 'aborted\n' } }),
      'FINAL: aborted',
    ];
    globalThis.fetch = async () => {
      const content = abortScript[Math.min(step, abortScript.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const aborting = new AgentLoop({
      files,
      terminal: defaultTerminal,
      ssh: defaultSshManager,
      context,
      llm,
      maxSteps: 4,
      confirmEdit: async () => {
        ctrl.abort();
        return true;
      },
    });
    const abortResult = await aborting.run('write then cancel', ctrl.signal);
    expect(abortResult.status === 'blocked', `abort status ${abortResult.status}`);
    expect((await fs.readFile(path.join(root, 'hello.txt'), 'utf8')) === 'hello\n', 'abort during accept does not write');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  await testEdits();
  await testAgentEdits();
  console.log('smoke-m3: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
