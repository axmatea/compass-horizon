import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calcFacing} from './facing.ts';
test('source-derived facing is a pure geometric helper, not a work or presence signal',()=>{
 assert.equal(calcFacing(20,20,50,45),'right');
 assert.equal(calcFacing(77,60,50,45),'left');
 assert.equal(calcFacing(50,60,50,45),'up');
 assert.equal(calcFacing(50,45,50,45),'down');
});
