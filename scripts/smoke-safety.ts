import {
  checkShellCommand,
  assertLocalSpendOnly,
  assertInsideProject,
} from '../src/modules/safety';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
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
expect(approved.ok, 'approved destructive should pass');

const spend = assertLocalSpendOnly(false);
expect(!spend.ok && spend.category === 'spend', 'spend gate');

const jail = assertInsideProject('/tmp/proj', '../etc/passwd');
expect(!jail.ok && jail.category === 'path_jail', 'path jail');

console.log('smoke-safety: PASS');
