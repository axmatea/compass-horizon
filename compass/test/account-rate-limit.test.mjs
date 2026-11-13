import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountRateLimiter,ACCOUNT_RATE_RULES} from '../account/rate-limit.mjs';
const read={method:'GET',path:'/api/account/apps'};
const mutation={method:'PUT',path:'/api/account/profile'};
const connect={method:'POST',path:'/api/account/integrations/github/connect'};
const billing={method:'POST',path:'/api/account/billing/checkout'};
test('read and mutation windows are independent, owner-scoped and reset at exact boundary',()=>{
  let at=0;const limiter=createAccountRateLimiter({now:()=>at});
  for(let i=0;i<ACCOUNT_RATE_RULES.read.limit;i++)assert.equal(limiter.check('a',read).allowed,true);
  assert.deepEqual(limiter.check('a',read),{allowed:false,retryAfterSeconds:60});assert.equal(limiter.check('b',read).allowed,true);
  for(let i=0;i<ACCOUNT_RATE_RULES.mutation.limit;i++)assert.equal(limiter.check('a',mutation).allowed,true);
  assert.equal(limiter.check('a',mutation).allowed,false);at=59999;assert.deepEqual(limiter.check('a',read),{allowed:false,retryAfterSeconds:1});
  at=60000;assert.equal(limiter.check('a',read).allowed,true);assert.equal(limiter.check('a',mutation).allowed,true);
});
test('connect and billing share general mutation bounds but keep stricter category windows',()=>{
  let at=0;const limiter=createAccountRateLimiter({now:()=>at});
  for(let i=0;i<10;i++)assert.equal(limiter.check('a',connect).allowed,true);
  assert.deepEqual(limiter.check('a',connect),{allowed:false,retryAfterSeconds:600});assert.equal(limiter.check('a',mutation).allowed,true);
  for(let i=0;i<10;i++)assert.equal(limiter.check('a',billing).allowed,true);
  assert.deepEqual(limiter.check('a',{method:'POST',path:'/api/account/billing/portal'}),{allowed:false,retryAfterSeconds:60});
  at=60000;assert.equal(limiter.check('a',billing).allowed,true);assert.deepEqual(limiter.check('a',connect),{allowed:false,retryAfterSeconds:540});
  at=600000;assert.equal(limiter.check('a',connect).allowed,true);
});
test('blocked attempts neither extend windows nor consume another category; failed general bound prevents stricter consumption',()=>{
  let at=0;const limiter=createAccountRateLimiter({now:()=>at});
  for(let i=0;i<60;i++)limiter.check('a',mutation);
  assert.deepEqual(limiter.check('a',connect),{allowed:false,retryAfterSeconds:60});
  at=60000;for(let i=0;i<10;i++)assert.equal(limiter.check('a',connect).allowed,true);
  at=120000;for(let i=0;i<100;i++)assert.equal(limiter.check('a',connect).allowed,false);
  at=660000;assert.equal(limiter.check('a',connect).allowed,true);
});
test('bounded TTL/LRU counters evict the least recently accessed owner and prune expired records',()=>{
  let at=0;const limiter=createAccountRateLimiter({now:()=>at,maxOwners:2});
  for(let i=0;i<300;i++)limiter.check('a',read);
  limiter.check('b',read);limiter.check('a',read);limiter.check('c',read);assert.equal(limiter.size,2);
  assert.equal(limiter.check('a',read).allowed,false,'recent owner preserves its quota');
  limiter.check('b',read);assert.equal(limiter.size,2);
  at=60000;limiter.check('new',read);assert.equal(limiter.size,1,'expired counters are removed');
  const maximum=createAccountRateLimiter({now:()=>at});for(let i=0;i<1100;i++)maximum.check('owner_'+i,read);assert.equal(maximum.size,1000);
});
test('limiter rejects invalid identity/configuration rather than trusting a client owner object',()=>{
  assert.throws(()=>createAccountRateLimiter({maxOwners:1001}),TypeError);
  const limiter=createAccountRateLimiter();assert.throws(()=>limiter.check({userId:'a'},read),TypeError);
  assert.throws(()=>createAccountRateLimiter({now:()=>NaN}).check('a',read),TypeError);
});
