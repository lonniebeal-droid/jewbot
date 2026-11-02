/**
 * M5 smoke: SSH allowlist, TOFU, streamed exec, and the destructive-command gate.
 * ssh2 is mocked. No sockets are opened. No secrets are written to disk.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentLoop } from '../src/modules/agent';
import { ContextIndexer } from '../src/modules/context';
import { FileWorkspace } from '../src/modules/files';
import { issueConfirmation, resetConfirmations } from '../src/modules/safety';
import {
  describeHostKey,
  formatSshObservation,
  SshConnectConfig,
  SshManager,
  createScriptedClientFactory,
  ssh2FactoryUsesRealClient,
} from '../src/modules/ssh';
import { TerminalSession } from '../src/modules/terminal';

const PASSPHRASE = 'correct-horse-battery';
const RAW_KEY = 'jewbot-test-host-key-material';

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

function sshString(value: string): Buffer {
  const body = Buffer.from(value);
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function hostKey(material: string): Buffer {
  return Buffer.concat([sshString('ssh-ed25519'), Buffer.from(material)]);
}

function ndjson(content: string): string {
  return (
    JSON.stringify({ message: { role: 'assistant', content }, done: false }) +
    '\n' +
    JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) +
    '\n'
  );
}

function writeKey(dir: string): string {
  const keyPath = path.join(dir, 'id_ed25519');
  fs.writeFileSync(keyPath, '-----BEGIN OPENSSH PRIVATE KEY-----\nsmoke-key-body\n-----END OPENSSH PRIVATE KEY-----\n', {
    mode: 0o600,
  });
  return keyPath;
}

async function testConfigRejectsSecrets() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jewbot-m5-cfg-'));
  try {
    const file = path.join(dir, 'hosts.json');
    const secret = 'super-secret-password';
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        hosts: [
          {
            name: 'pi',
            host: '127.0.0.1',
            username: 'pi',
            privateKeyPath: writeKey(dir),
            password: secret,
          },
        ],
      }),
    );
    const ssh = new SshManager({ hostsPath: file, knownHostsPath: path.join(dir, 'known.json'), autoload: true });
    const error = ssh.inventory().error || '';
    expect(error.includes('password'), `error should name the field (${error})`);
    expect(error.includes('pi'), 'error should name the host');
    expect(!error.includes(secret), 'hosts error leaked a secret');
    expect(ssh.listHosts().length === 0, 'secret-bearing file is not an allowlist');

    const good = path.join(dir, 'good.json');
    await fs.promises.writeFile(
      good,
      JSON.stringify({
        hosts: [
          { name: 'pi', host: '127.0.0.1', port: 22, username: 'pi', privateKeyPath: writeKey(dir) },
          { name: 'mac', host: 'mac.local', username: 'lonnie', agent: true },
        ],
      }),
    );
    ssh.configure({ hostsPath: good });
    const names = ssh.listHosts().map((host) => host.name).sort();
    expect(names.join(',') === 'mac,pi', `loaded ${names.join(',')}`);
    expect(ssh.listHosts().every((host) => !('password' in host)), 'public host list has no password field');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function testAllowlistTofuAndStream() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jewbot-m5-ssh-'));
  const knownPath = path.join(dir, 'known_hosts.json');
  const keyPath = writeKey(dir);
  const keyMaterial = hostKey(RAW_KEY);
  const otherMaterial = hostKey('other-host-key-material-xyz');
  const fingerprint = describeHostKey(keyMaterial).fingerprint;
  const scripted = {
    hostKey: keyMaterial,
  };
  const execs: string[] = [];
  let ended = 0;
  let seenPassphrase = false;
  const ssh = new SshManager({
    knownHostsPath: knownPath,
    autoload: false,
    clientFactory: createScriptedClientFactory({
      get hostKey() {
        return scripted.hostKey;
      },
      onConnect(config: SshConnectConfig) {
        seenPassphrase = config.passphrase === PASSPHRASE;
      },
      onExec(command) {
        execs.push(command);
        if (command.startsWith('echo ')) {
          const echoed = command.slice('echo '.length);
          return {
            chunks: [
              { stream: 'stdout', text: 'one\n', delayMs: 5 },
              { stream: 'stderr', text: 'err\n', delayMs: 5 },
              { stream: 'stdout', text: echoed + '\n', delayMs: 5 },
            ],
            exitCode: 0,
          };
        }
        if (command === 'hang') return { hang: true };
        return { stdout: 'ran\n', exitCode: 0 };
      },
      onEnd() {
        ended += 1;
      },
    }),
  });
  ssh.registerHost({
    name: 'pi',
    host: '127.0.0.1',
    port: 22,
    username: 'pi',
    privateKeyPath: keyPath,
    askPassphrase: true,
  });

  try {
    await expectThrow(() => ssh.connect('dell'), /not allowlisted/, 'unknown host is refused');
    const blockedExec = await ssh.exec('dell', 'uname', { approved: true, executionId: 'attacker-supplied-id' });
    expect(blockedExec.status === 'BLOCKED', `unlisted exec status ${blockedExec.status}`);
    expect(execs.length === 0, 'unlisted exec must not open a channel');

    let prompts = 0;
    await expectThrow(
      () =>
        ssh.connect('pi', {
          promptSecret: async () => null,
        }),
      /cancelled/,
      'cancelled passphrase does not connect',
    );
    expect(ssh.listSessions().length === 0, 'cancel left no session');

    let hostPrompts = 0;
    await expectThrow(
      () =>
        ssh.connect('pi', {
          promptSecret: async (req) => {
            prompts += 1;
            expect(req.kind === 'passphrase', `prompt kind ${req.kind}`);
            return PASSPHRASE;
          },
          confirmHostKey: async () => {
            hostPrompts += 1;
            return false;
          },
        }),
      /denied|verification failed/,
      'rejected TOFU does not connect',
    );
    expect(hostPrompts === 1, `host prompt once, got ${hostPrompts}`);
    expect(!fs.existsSync(knownPath), 'rejected TOFU wrote a known host');
    expect(!seenPassphrase, 'rejected TOFU still authenticated');

    const connected = await ssh.connect('pi', {
      promptSecret: async () => PASSPHRASE,
      confirmHostKey: async (req) => {
        hostPrompts += 1;
        expect(req.mismatch === false, 'first key is not a mismatch');
        expect(req.fingerprint === fingerprint, 'prompt shows the computed fingerprint');
        expect(!req.fingerprint.includes(RAW_KEY), 'prompt is a fingerprint, not the raw key');
        return true;
      },
    });
    expect(connected.name === 'pi', 'connected name');
    expect(connected.fingerprint === fingerprint, 'session records the fingerprint');
    expect(seenPassphrase, 'passphrase reached the client');
    expect(ssh.listSessions().length === 1, 'one session');
    const known = fs.readFileSync(knownPath, 'utf8');
    expect(known.includes(fingerprint), 'known hosts stores the fingerprint');
    expect(!known.includes(PASSPHRASE), 'known hosts leaked the passphrase');
    expect(!known.includes(RAW_KEY), 'known hosts leaked the raw host key');
    expect(!known.includes('smoke-key-body'), 'known hosts leaked the private key');
    expect((fs.statSync(knownPath).mode & 0o777) === 0o600, `known hosts mode ${fs.statSync(knownPath).mode.toString(8)}`);

    const again = await ssh.connect('pi', {
      confirmHostKey: async () => {
        hostPrompts += 1;
        return false;
      },
    });
    expect(again.sessionId === connected.sessionId, 'second connect reuses the session');
    expect(hostPrompts === 2, `trusted reconnect must not prompt again, prompts=${hostPrompts}`);

    const chunks: string[] = [];
    const streamed = await ssh.exec('pi', 'echo jewbot-m5', {
      onChunk: (chunk) => chunks.push(`${chunk.stream}:${chunk.text}`),
    });
    expect(streamed.status === 'EXECUTED' && streamed.exitCode === 0, `echo status ${streamed.status} ${streamed.exitCode}`);
    expect(streamed.stdout.includes('one') && streamed.stdout.includes('jewbot-m5'), `stdout ${JSON.stringify(streamed.stdout)}`);
    expect(streamed.stderr.includes('err'), `stderr ${JSON.stringify(streamed.stderr)}`);
    expect(chunks[0] === 'stdout:one\n' && chunks.some((line) => line.startsWith('stderr:')), `chunk order ${chunks.join('|')}`);
    expect(formatSshObservation(streamed).includes('exit_code: 0'), 'observation includes the exit code');

    resetConfirmations();
    const destructive = 'rm -rf /tmp/jewbot-m5-victim';
    const before = execs.length;
    const denied = await ssh.exec('pi', destructive, { approved: true, executionId: 'attacker-supplied-id' });
    expect(denied.status === 'BLOCKED', `unapproved rm status ${denied.status}`);
    expect(execs.length === before, 'destructive exec ran without a grant');
    expect(!denied.stderr.includes(PASSPHRASE), 'block reason leaked the passphrase');

    const { executionId } = issueConfirmation(destructive);
    const allowed = await ssh.exec('pi', destructive, { executionId });
    expect(allowed.status === 'EXECUTED', `granted rm status ${allowed.status} ${allowed.stderr}`);
    expect(execs.at(-1) === destructive, 'granted command was sent once');
    const reused = await ssh.exec('pi', destructive, { executionId });
    expect(reused.status === 'BLOCKED', 'grant cannot be reused');

    const echoed = await ssh.exec('pi', `echo ${PASSPHRASE}`);
    expect(!echoed.stdout.includes(PASSPHRASE), 'stdout leaked the in-memory passphrase');
    expect(echoed.stdout.includes('[REDACTED]'), `stdout should redact the passphrase (${JSON.stringify(echoed.stdout).includes(PASSPHRASE) ? 'leaked' : echoed.stdout})`);

    const hanging = ssh.startExec('pi', 'hang', { timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ssh.killExec(hanging.execId), 'kill returns true');
    const killed = await hanging.done;
    expect(killed.killed, 'exec marked killed');
    expect(killed.status === 'EXECUTED', `killed status ${killed.status}`);
    expect(ssh.killExec(hanging.execId) === false, 'second kill is a no-op');

    expect(ssh.disconnect('pi'), 'disconnect');
    expect(ssh.listSessions().length === 0, 'session list is empty');
    expect(ended >= 1, 'client end was called');

    scripted.hostKey = otherMaterial;
    let mismatch = false;
    await expectThrow(
      () =>
        ssh.connect('pi', {
          promptSecret: async () => PASSPHRASE,
          confirmHostKey: async (req) => {
            mismatch = req.mismatch === true && req.previousFingerprint === fingerprint;
            return false;
          },
        }),
      /denied|verification failed/,
      'changed host key is refused when the owner says no',
    );
    expect(mismatch, 'mismatch prompt includes the previous fingerprint');
    const still = fs.readFileSync(knownPath, 'utf8');
    expect(still.includes(fingerprint), 'rejected mismatch kept the stored fingerprint');
    expect(!still.includes(describeHostKey(otherMaterial).fingerprint), 'rejected mismatch did not replace the fingerprint');
  } finally {
    ssh.closeAll();
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function testAgentSsh() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jewbot-m5-agent-'));
  const original = globalThis.fetch;
  const keyPath = writeKey(dir);
  const material = hostKey(RAW_KEY);
  const execs: string[] = [];
  const destructive = 'rm -rf /tmp/jewbot-m5-agent';
  const ssh = new SshManager({
    knownHostsPath: path.join(dir, 'known_hosts.json'),
    autoload: false,
    clientFactory: createScriptedClientFactory({
      hostKey: material,
      onExec(command) {
        execs.push(command);
        return { stdout: command.includes('echo') ? 'from-pi\n' : 'ran\n', exitCode: 0 };
      },
    }),
  });
  ssh.registerHost({
    name: 'pi',
    host: '127.0.0.1',
    username: 'pi',
    privateKeyPath: keyPath,
  });
  const files = new FileWorkspace(dir);
  let step = 0;
  let asked = 0;
  let hostAsks = 0;
  try {
    const script = [
      JSON.stringify({ tool: 'ssh_list_hosts', args: {} }),
      JSON.stringify({ tool: 'ssh_connect', args: { host: 'dell' } }),
      JSON.stringify({ tool: 'ssh_connect', args: { host: 'pi' } }),
      JSON.stringify({
        tool: 'ssh_exec',
        args: { host: 'pi', command: destructive, approved: true, executionId: 'attacker' },
      }),
      JSON.stringify({ tool: 'ssh_exec', args: { host: 'pi', command: 'echo from-pi' } }),
      JSON.stringify({ tool: 'ssh_exec', args: { host: 'pi', command: destructive, approved: true, executionId: 'still-no' } }),
      JSON.stringify({ tool: 'ssh_disconnect', args: { host: 'pi' } }),
      'FINAL: saw from-pi',
    ];
    globalThis.fetch = async () => {
      const content = script[Math.min(step, script.length - 1)];
      step += 1;
      return new Response(ndjson(content), { status: 200 });
    };
    const events: string[] = [];
    const agent = new AgentLoop({
      files,
      terminal: new TerminalSession(),
      ssh,
      context: new ContextIndexer(dir),
      llm: { host: 'http://127.0.0.1:11434', model: 'test-model', allowPaidApis: false },
      maxSteps: 10,
      confirmHostKey: async (req) => {
        hostAsks += 1;
        expect(req.fingerprint.startsWith('SHA256:'), 'agent TOFU prompt has a fingerprint');
        expect(!req.fingerprint.includes(RAW_KEY), 'agent prompt is not the raw host key');
        return true;
      },
      confirmDestructive: async (req) => {
        asked += 1;
        expect(req.command === destructive, 'confirm sees the remote command');
        return asked >= 2;
      },
    });
    let final = '';
    let observations = '';
    for await (const ev of agent.runStream('check the pi')) {
      if (ev.type === 'ssh_chunk') events.push(ev.text);
      if (ev.type === 'done') {
        final = ev.result.finalText || ev.result.blockReason || ev.result.status;
        observations = ev.result.steps.map((item) => item.observation || '').join('\n');
      }
    }
    expect(final === 'saw from-pi', `agent final ${final}`);
    expect(observations.includes('pi pi@127.0.0.1:22'), `list observation ${observations}`);
    expect(observations.includes('not allowlisted'), `dell should be refused: ${observations}`);
    expect(observations.includes('CONNECTED pi'), `connect observation ${observations}`);
    expect(observations.includes('BLOCKED'), `denied rm should be blocked: ${observations}`);
    expect(observations.includes('from-pi'), `echo observation ${observations}`);
    expect(observations.includes('DISCONNECTED pi'), `disconnect observation ${observations}`);
    expect(events.some((text) => text.includes('from-pi')), `streamed chunks ${JSON.stringify(events)}`);
    expect(asked === 2, `destructive gate asked twice, got ${asked}`);
    expect(hostAsks === 1, `TOFU asked once, got ${hostAsks}`);
    expect(execs.length === 2 && execs[0] === 'echo from-pi' && execs[1] === destructive, `execs ${execs.join(' | ')}`);
  } finally {
    ssh.closeAll();
    globalThis.fetch = original;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function testRealClientFactory() {
  expect(ssh2FactoryUsesRealClient(), 'default factory returns an ssh2 Client and does not connect');
}

async function main() {
  await testConfigRejectsSecrets();
  await testAllowlistTofuAndStream();
  await testAgentSsh();
  testRealClientFactory();
  console.log('smoke-m5: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
