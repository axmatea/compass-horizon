import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceReturn,afterSignupLocation} from '../src/acquisition/login-return.ts';
test('team invite survives registration and login without an open redirect',()=>{
  const token='a'.repeat(43);
  assert.equal(workspaceReturn('/login',`?returnTo=/app&workspaceInvite=${token}`),`/app?workspaceInvite=${token}`);
  assert.equal(afterSignupLocation('/login',`?token=${token}&returnTo=/app&workspaceInvite=${token}`),`/login?returnTo=/app&workspaceInvite=${token}`);
  assert.equal(workspaceReturn('/login','?returnTo=https://evil.test'),null);
  assert.equal(workspaceReturn('/login','?returnTo=/app&workspaceInvite=bad'),'/app');
  assert.equal(afterSignupLocation('/acquisition/app','?token=x'),'/acquisition/app');
});
