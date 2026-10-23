import {
  assertInsideProject,
  assertLocalSpendOnly,
  checkShellCommand,
  consumeConfirmation,
  issueConfirmation,
  resetConfirmations,
} from '../src/modules/safety';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function blocked(command: string, category: 'destructive_shell' | 'destructive_git', label: string) {
  const decision = checkShellCommand(command);
  expect(!decision.ok, `${label} should not be ok (${command})`);
  if (decision.ok) return;
  expect(decision.needsConfirmation, `${label} should need confirmation (${command})`);
  expect(decision.category === category, `${label} category ${decision.category} (${command})`);
}

function allowed(command: string, label: string) {
  const decision = checkShellCommand(command);
  expect(decision.ok, `${label} should be ok (${command}) got ${decision.ok ? '' : decision.reason}`);
}

const blockedRm = checkShellCommand('rm -rf /tmp/x');
expect(!blockedRm.ok && blockedRm.needsConfirmation, 'rm -rf should need confirmation');

const blockedForce = checkShellCommand('git push --force origin main');
expect(!blockedForce.ok && blockedForce.category === 'destructive_git', 'force push blocked');

const okEcho = checkShellCommand('echo hello');
expect(okEcho.ok, 'echo should be ok');

const approved = checkShellCommand('rm -rf ./build', {
  approved: true,
  executionId: 'shell-test-12345678',
});
expect(approved.ok, 'claimed approval short-circuits classification only');

const spend = assertLocalSpendOnly(false);
expect(!spend.ok && spend.category === 'spend', 'spend gate');

const jail = assertInsideProject('/tmp/proj', '../etc/passwd');
expect(!jail.ok && jail.category === 'path_jail', 'path jail');

blocked('rm -fr /tmp/x', 'destructive_shell', 'rm -fr');
blocked('rm -r -f /tmp/x', 'destructive_shell', 'rm -r -f');
blocked('rm -f -r /tmp/x', 'destructive_shell', 'rm -f -r');
blocked('/bin/rm -rf /tmp/x', 'destructive_shell', 'absolute rm');
blocked('sudo rm -rf /tmp/x', 'destructive_shell', 'sudo rm');
blocked("bash -c 'rm -rf /tmp/x'", 'destructive_shell', 'bash -c rm');
blocked('echo kept && rm -rf /tmp/x', 'destructive_shell', 'chained rm');
blocked('mkfs.ext4 /dev/sdb', 'destructive_shell', 'mkfs');
blocked('dd of=/dev/sda bs=1M', 'destructive_shell', 'dd of=');
blocked('dd if=/dev/zero of=/dev/sdb', 'destructive_shell', 'dd if= and of=');
blocked('chmod -R 777 /', 'destructive_shell', 'chmod root');
blocked('chmod -R 0777 /', 'destructive_shell', 'chmod 0777 root');
blocked('sudo chmod --recursive a+rwx /', 'destructive_shell', 'chmod a+rwx');
blocked('chmod -R 777 ./build', 'destructive_shell', 'chmod recursive 777');
blocked('shutdown -h now', 'destructive_shell', 'shutdown');
blocked('echo x > /dev/sda', 'destructive_shell', 'block redirect');
blocked('git push --force origin main', 'destructive_git', 'push --force');
blocked('git push -f origin main', 'destructive_git', 'push -f');
blocked('git push origin main --force', 'destructive_git', 'push trailing --force');
blocked('git push origin +main', 'destructive_git', 'push plus refspec');
blocked('git -C /tmp reset --hard HEAD', 'destructive_git', 'reset --hard');
blocked('git clean -fdx', 'destructive_git', 'clean -fdx');
blocked('git branch -D feature', 'destructive_git', 'branch -D');

allowed('echo hello', 'echo');
allowed('ls -la', 'ls');
allowed('rm README.md', 'rm one file');
allowed('git status', 'git status');
allowed('git push origin main', 'regular push');
allowed('git branch -d feature', 'safe branch delete');
allowed('chmod 644 src/main.ts', 'chmod file');
allowed('chmod -R 755 src', 'chmod 755');
allowed('dd', 'bare dd');

resetConfirmations();
const grant = issueConfirmation('rm -rf /tmp/a');
expect(consumeConfirmation(grant.executionId, 'rm -rf /tmp/a'), 'grant matches command');
expect(!consumeConfirmation(grant.executionId, 'rm -rf /tmp/a'), 'grant is one-shot');

const mismatch = issueConfirmation('rm -rf /tmp/a');
expect(!consumeConfirmation(mismatch.executionId, 'rm -rf /tmp/b'), 'grant rejects a different command');
expect(!consumeConfirmation(mismatch.executionId, 'rm -rf /tmp/a'), 'mismatch burns the grant');
expect(!consumeConfirmation('exec_not-a-real-grant', 'rm -rf /tmp/a'), 'unknown id is not a grant');

const unapproved = checkShellCommand('echo hello', { requireApproval: true });
expect(!unapproved.ok && unapproved.category === 'unapproved', 'optional approval flag still works');

console.log('smoke-safety: PASS');
